/**
 * cleanupDuplicateLogs — 운행일지 중복 데이터 탐지 및 정리
 *
 * ## 조회 범위에 상한을 두는 이유
 * 처음에는 기관의 운행일지를 **전량** 읽었다. 기록이 쌓일수록 느려지고, 결국 120초
 * 제한에 닿아 프로덕션에서 `FirebaseError: deadline-exceeded`로 실패했다
 * (Sentry JAVASCRIPT-REACT-5V, /admin/logs). 인덱스는 있으니 인덱스 문제가 아니라
 * 물량 문제라, 인덱스를 더 만들어도 해결되지 않고 상한을 두는 것이 처방이다.
 *
 * 중복은 이중 제출로 **생성 시점에** 만들어지므로 최근 구간만 봐도 목적을 달성한다.
 * 다만 조용히 좁히지 않는다 — 검사한 범위를 응답에 실어 화면이 "최근 N개월 기준"임을
 * 밝히게 한다. 더 넓게 훑어야 하면 `months`로 늘려 부른다(최대 60개월).
 *
 * `createdAt` 범위 필터는 `orderBy("createdAt")`과 같은 필드라 기존 인덱스
 * `(organizationId, createdAt asc)`로 그대로 처리된다. `createdAt`이 없는 문서가
 * 빠지는 것은 이전과 같다 — orderBy가 이미 그 문서들을 건너뛰고 있었다.
 */
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { getKSTDateString } from "../../utils/kstDate";

/** 기본 조회 범위(개월). 중복은 생성 시점에 생기므로 최근 구간이면 충분하다. */
export const DEFAULT_SCAN_MONTHS = 6;
/** 호출자가 넓혀 부를 수 있는 상한. 이보다 넓히면 다시 120초 제한에 닿는다. */
export const MAX_SCAN_MONTHS = 60;

/** 요청의 `months`를 유효 범위로 정규화한다. 숫자가 아니거나 1 미만이면 기본값. */
export function resolveScanMonths(raw: unknown): number {
    const n = typeof raw === "number" ? Math.floor(raw) : NaN;
    if (!Number.isFinite(n) || n < 1) return DEFAULT_SCAN_MONTHS;
    return Math.min(n, MAX_SCAN_MONTHS);
}

/**
 * 조회 시작 시각을 구한다.
 *
 * 말일 보정은 하지 않는다 — 8/31에서 6개월을 빼면 3/3이 되지만, 경계가 며칠
 * 움직이는 것은 중복 탐지에 영향을 주지 않는다(중복은 같은 날짜끼리만 묶인다).
 */
export function getScanCutoff(months: number, now: Date = new Date()): Date {
    const cutoff = new Date(now);
    cutoff.setMonth(cutoff.getMonth() - months);
    return cutoff;
}

export const cleanupDuplicateLogs = onCall(
    {
        region: "asia-northeast3",
        timeoutSeconds: 120,
        enforceAppCheck: true,
    },
    async (request) => {
        if (!request.auth) {
            throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
        }

        const { organizationId, dryRun = true } = request.data;

        if (!organizationId) {
            throw new HttpsError("invalid-argument", "organizationId가 필요합니다.");
        }

        // 권한은 Firestore 문서가 아닌 Custom Claims 기준 (firestore.rules·requireSuperAdmin과 동일)
        const callerRole = request.auth.token.role as string;
        if (!["admin", "superAdmin"].includes(callerRole)) {
            throw new HttpsError("permission-denied", "관리자만 사용할 수 있습니다.");
        }

        // 교차 테넌트 차단: admin은 자신의 기관만 정리 가능, superAdmin만 타 기관 허용
        if (callerRole !== "superAdmin" && request.auth.token.orgId !== organizationId) {
            throw new HttpsError("permission-denied", "자신의 기관 데이터만 정리할 수 있습니다.");
        }

        const db = getFirestore();
        const scanMonths = resolveScanMonths(request.data?.months);
        const since = getScanCutoff(scanMonths);

        try {
            const logsSnap = await db.collection("driveLogs")
                .where("organizationId", "==", organizationId)
                .where("createdAt", ">=", since)
                .orderBy("createdAt", "asc")
                .get();

            console.log(`[cleanupDuplicateLogs] 기관=${organizationId}, 최근 ${scanMonths}개월(${since.toISOString()}) ${logsSnap.size}건 조회`);

            const logMap = new Map<string, Array<{ id: string; createdAt: unknown; dateStr: string }>>();

            logsSnap.forEach((doc) => {
                const data = doc.data();
                const ts = data.timestamp?.toDate ? data.timestamp.toDate() : null;
                const dateStr = ts ? getKSTDateString(ts) : "unknown";

                const key = `${dateStr}|${data.vehicleId}|${data.driverUid}|${data.startKm}|${data.endKm}`;

                if (!logMap.has(key)) {
                    logMap.set(key, []);
                }
                logMap.get(key)!.push({ id: doc.id, createdAt: data.createdAt, dateStr });
            });

            const duplicateGroups: Array<{ key: string; count: number; keepId: string; deleteIds: string[] }> = [];
            const deleteTargets: string[] = [];

            for (const [key, group] of logMap) {
                if (group.length > 1) {
                    const toDelete = group.slice(1).map((g) => g.id);
                    duplicateGroups.push({
                        key,
                        count: group.length,
                        keepId: group[0].id,
                        deleteIds: toDelete,
                    });
                    deleteTargets.push(...toDelete);
                }
            }

            console.log(`[cleanupDuplicateLogs] 중복 그룹: ${duplicateGroups.length}개, 삭제 대상: ${deleteTargets.length}건`);

            if (!dryRun && deleteTargets.length > 0) {
                const batchSize = 500;
                for (let i = 0; i < deleteTargets.length; i += batchSize) {
                    const batch = db.batch();
                    const chunk = deleteTargets.slice(i, i + batchSize);
                    chunk.forEach((id) => {
                        batch.delete(db.collection("driveLogs").doc(id));
                    });
                    await batch.commit();
                    console.log(`[cleanupDuplicateLogs] 삭제 완료: ${i + chunk.length}/${deleteTargets.length}`);
                }
            }

            return {
                success: true,
                totalLogs: logsSnap.size,
                duplicateGroups: duplicateGroups.length,
                deleteCount: deleteTargets.length,
                dryRun,
                // 검사 범위를 함께 돌려준다 — 화면이 "전량"이 아니라 "최근 N개월"임을 밝혀야
                // 사용자가 0건을 전량 무결로 오해하지 않는다
                scanMonths,
                since: since.toISOString(),
                details: duplicateGroups.slice(0, 50),
            };
        } catch (err: unknown) {
            console.error("cleanupDuplicateLogs 실패:", (err as Error).message);
            throw new HttpsError("internal", (err as Error).message);
        }
    }
);
