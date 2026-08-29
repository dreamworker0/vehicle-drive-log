import { getFirestore } from 'firebase-admin/firestore';
import { toKSTDate } from '../../utils/kstDate';
import { captureWarning } from '../../core/sentry';

/**
 * 운행일지 정합성 월간 검증.
 *
 * ## 왜 경로를 고쳤는가
 *
 * 이전 구현은 `organizations/{orgId}/vehicles`·`organizations/{orgId}/driveLogs`
 * **서브컬렉션**을 스캔했다. 그런 컬렉션은 존재하지 않는다 — 차량·운행일지는 최상위
 * 컬렉션에 `organizationId` 필드로 구분해 저장한다(firestore.rules의
 * `match /vehicles/{vehicleId}`·`match /driveLogs/{logId}`, dailyNightlyBatch도 동일).
 * 즉 이 검증은 매달 빈 컬렉션을 돌며 "불일치 0건"을 보고하고 있었다. 찾을 수 있는
 * 구조가 아니었으므로 0건은 정상이라는 근거가 되지 못한다.
 *
 * ## 무엇을 보는가
 *
 * 1. **마일리지 연속성** — 같은 차량에서 직전 기록의 도착 km와 다음 기록의 출발 km 불일치
 * 2. **참조 무결성** — `driverUid`·`vehicleId`가 실재하고 **같은 기관 소속**인지
 *    (2026-07 감사 F-01/F-02에서 위험 수용의 전제로 명시된 보완 통제다. Rules는
 *     no-get 원칙 때문에 create 시점에 이 둘을 검증하지 않으므로, 탐지는 여기서 한다.)
 *
 * ## 비용
 *
 * 전수 스캔은 읽기가 무한정 늘어나므로 **지난달분만** 조회한다(월 1회 실행 전제).
 * 차량·사용자는 기관 수 대비 작아 한 번씩 전량 로드해 메모리에서 대조한다.
 */

export interface DriveLogLite {
    id: string;
    organizationId?: string;
    vehicleId?: string;
    driverUid?: string;
    startKm?: number;
    endKm?: number;
}

/**
 * 참조 무결성 위반 목록을 만든다 (F-01/F-02 탐지의 핵심 판정).
 *
 * Firestore 접근과 분리해 순수 함수로 둔다 — 판정 규칙이 이 통제의 전부이므로
 * 에뮬레이터 없이도 단위 테스트로 고정할 수 있어야 한다.
 */
export function findReferenceIssues(
    logs: DriveLogLite[],
    vehicleOrg: Map<string, string | undefined>,
    userOrg: Map<string, string | undefined>,
): string[] {
    const issues: string[] = [];
    for (const entry of logs) {
        const orgId = entry.organizationId;
        if (!orgId) continue;

        if (entry.vehicleId) {
            const owner = vehicleOrg.get(entry.vehicleId);
            if (!vehicleOrg.has(entry.vehicleId)) {
                issues.push(`log=${entry.id} vehicleId=${entry.vehicleId} 없는 차량`);
            } else if (owner !== orgId) {
                issues.push(`log=${entry.id} vehicleId=${entry.vehicleId} 타 기관 차량(${owner})`);
            }
        }
        if (entry.driverUid) {
            const owner = userOrg.get(entry.driverUid);
            if (!userOrg.has(entry.driverUid)) {
                issues.push(`log=${entry.id} driverUid=${entry.driverUid} 없는 사용자`);
            } else if (owner !== orgId) {
                issues.push(`log=${entry.id} driverUid=${entry.driverUid} 타 기관 사용자(${owner})`);
            }
        }
    }
    return issues;
}

/** 같은 차량의 인접 기록에서 도착 km ≠ 다음 출발 km 인 지점을 센다. */
export function countMileageGaps(logs: DriveLogLite[]): number {
    const byVehicle = new Map<string, DriveLogLite[]>();
    for (const entry of logs) {
        if (!entry.organizationId || !entry.vehicleId) continue;
        const key = `${entry.organizationId}/${entry.vehicleId}`;
        const bucket = byVehicle.get(key) ?? [];
        bucket.push(entry);
        byVehicle.set(key, bucket);
    }

    let gaps = 0;
    for (const [key, group] of byVehicle) {
        const ordered = group
            .filter((l) => typeof l.startKm === 'number' && typeof l.endKm === 'number')
            .sort((a, b) => (a.startKm as number) - (b.startKm as number));

        for (let i = 0; i < ordered.length - 1; i++) {
            const previous = ordered[i];
            const next = ordered[i + 1];
            if (previous.endKm !== next.startKm) {
                console.warn(
                    `[Mileage Inconsistency] ${key} — 이전(${previous.id}) ${previous.startKm}→${previous.endKm}, ` +
                    `다음(${next.id}) ${next.startKm}→${next.endKm}`,
                );
                gaps++;
            }
        }
    }
    return gaps;
}

export async function verifyMileageConsistency(): Promise<void> {
    const db = getFirestore();

    // 지난달 1일 00:00 (KST) ~ 이번달 1일 00:00 (KST)
    const now = toKSTDate();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const label = `${prevMonthStart.getFullYear()}-${String(prevMonthStart.getMonth() + 1).padStart(2, '0')}`;

    console.log(`[verifyDriveLogIntegrity] 검증 시작 대상 기간: ${label}`);

    const logsSnap = await db
        .collection('driveLogs')
        .where('timestamp', '>=', prevMonthStart)
        .where('timestamp', '<', monthStart)
        .get();

    if (logsSnap.empty) {
        console.log('[verifyDriveLogIntegrity] 대상 기간에 운행일지 없음. 스킵.');
        return;
    }

    const logs: DriveLogLite[] = logsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as DriveLogLite));

    // 참조 대조용 — 차량·사용자의 소속 기관을 미리 적재한다.
    const [vehiclesSnap, usersSnap] = await Promise.all([
        db.collection('vehicles').get(),
        db.collection('users').get(),
    ]);
    const vehicleOrg = new Map<string, string | undefined>(
        vehiclesSnap.docs.map((d) => [d.id, d.data().organizationId as string | undefined]),
    );
    const userOrg = new Map<string, string | undefined>(
        usersSnap.docs.map((d) => [d.id, d.data().organizationId as string | undefined]),
    );

    const referenceIssues = findReferenceIssues(logs, vehicleOrg, userOrg);
    const mileageGaps = countMileageGaps(logs);

    console.log(
        `[verifyDriveLogIntegrity] 검증 완료 (${label}, 대상 ${logs.length}건). ` +
        `마일리지 불일치 ${mileageGaps}건, 참조 무결성 위반 ${referenceIssues.length}건`,
    );

    // 참조 무결성 위반은 Rules가 막지 않는 영역이라 조용히 넘기면 탐지 수단이 사라진다.
    if (referenceIssues.length > 0) {
        console.warn(`[Reference Integrity] ${referenceIssues.slice(0, 50).join(' | ')}`);
        captureWarning('운행일지 참조 무결성 위반 감지', {
            context: 'verifyDriveLogIntegrity',
            period: label,
            count: referenceIssues.length,
            samples: referenceIssues.slice(0, 20),
        });
    }
}
