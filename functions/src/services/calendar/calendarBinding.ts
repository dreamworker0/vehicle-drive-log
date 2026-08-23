/**
 * calendarBinding — 구글 캘린더 ID ↔ 기관 바인딩
 *
 * ## 왜 필요한가 (2026-08-23 감사 발견 1)
 *
 * 캘린더 동기화는 **모든 기관이 같은 하나의 서비스 계정에 자기 캘린더를 공유하는** 구조다.
 * 그래서 그 서비스 계정에게는 참여 기관 전체의 캘린더가 열려 있고, 어느 캘린더를 건드릴지
 * 정하는 값은 차량 문서의 `googleCalendarId` 문자열 하나뿐이었다. 그 문자열은 기관 관리자가
 * 자유 입력하고, 검증은 `@` 포함 여부가 전부였다 — 즉 **다른 기관의 캘린더 ID를 적으면
 * 그 기관의 일정이 우리 기관 예약으로 유입되고(정보 유출), 우리가 그 예약을 지우면 원본
 * 일정이 지워졌다(무결성 파괴).**
 *
 * 이 앱의 다른 모든 테넌트 경계는 `organizationId`·커스텀 클레임으로 **서버가** 판정한다.
 * 캘린더만 클라이언트가 적어 넣은 외부 식별자가 경계 역할을 하고 있었다. 이 모듈은 그
 * 외부 식별자에 **서버 소유의 바인딩**을 붙여 경계를 되돌려 놓는다.
 *
 * ## 정책 — 선점 등록(first-use wins)
 *
 * - 처음 쓰이는 캘린더 ID는 그 순간의 기관에 귀속된다(`calendarBindings/{sha256(id)}` 생성).
 * - 이미 다른 기관에 귀속된 ID는 **캘린더 API를 호출하기 전에** 거절한다. 요청 자체를
 *   보내지 않으므로 유출도, 쿼터 소모도 없다.
 * - 기존 연동 기관은 `scripts/seed-calendar-bindings.ts`로 현재 상태를 그대로 등록한다.
 *   시딩을 건너뛰면 아직 동기화를 돌리지 않은 기관의 ID를 남이 선점할 수 있다.
 *
 * 캘린더 ID를 문서 ID로 그대로 쓰지 않는 이유: 캘린더 ID는 이메일 주소이거나 `.`·`__`를
 * 포함할 수 있어 Firestore 문서 ID 제약(`.`·`..`·`__*__` 금지)과 충돌한다. sha256 해시를
 * ID로 쓰고 원문은 필드에 남겨 운영자가 콘솔에서 읽을 수 있게 한다.
 */
import { createHash } from "node:crypto";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { captureWarning } from "../../core/sentry";

/** 바인딩 문서 컬렉션 — 서버(Admin SDK) 전용. firestore.rules에서 클라이언트 접근을 막는다. */
const COLLECTION = "calendarBindings";

/**
 * 한 번의 실행 안에서 바인딩 조회를 모으는 캐시 (isGoogleCalendarEnabled와 같은 이유).
 * 역동기화는 차량을 순회하며 차량마다 이 함수를 부르고, 한 기관은 보통 모든 차량에 같은
 * 캘린더를 쓴다("기관 내 모든 차량에 같은 캘린더 ID를 사용하면 통합 관리가 편리합니다").
 * 캐시가 없으면 같은 문서를 차량 대수만큼 다시 읽는다.
 *
 * 모듈 전역으로 두지 않는 이유도 같다 — 인스턴스가 사는 동안 값이 굳으면 운영자가 바인딩을
 * 정리한 뒤에도 옛 판정이 남는다. 호출자가 실행 단위로 Map을 만들어 넘긴다.
 */
export type CalendarBindingCache = Map<string, boolean>;

/**
 * 같은 인스턴스에서 같은 충돌을 반복 알리지 않기 위한 기록.
 *
 * 스케줄러는 하루 34회 돈다. 잘못 등록된 차량 하나 때문에 디스코드가 도배되면 그 채널은
 * 무뎌진다(core/sentry의 captureWarning 주석과 같은 이유). 인스턴스 수명(수분~수시간)
 * 단위로 한 번만 알리고, 구조화 로그는 매번 남긴다 — 알림은 사람용, 로그는 추적용이다.
 */
const alertedConflicts = new Set<string>();
/** 알림 기록 상한 — 비정상 상황에서 이 Set이 메모리를 먹지 않게 한다(넘으면 비우고 다시 센다). */
const ALERTED_CONFLICTS_MAX = 500;

/**
 * 캘린더 ID로 쓰일 수 없는 주소 — **서비스 계정 이메일**.
 *
 * FAQ는 "캘린더를 이 서비스 계정과 *공유*하라"고 안내하는데(shared/faqData.ts), 그 주소를
 * 캘린더 ID 칸에 그대로 붙여 넣은 기관이 실제로 있었다 — 2026-08-23 시딩에서 3개 기관·차량
 * 8대가 같은 서비스 계정 주소를 가리키고 있었다.
 *
 * 이 값은 **어느 기관의 캘린더도 아니면서 모든 기관이 같은 곳을 가리키게 만든다.** 즉 사고로
 * 만들어진 공유 버킷이고, 접근이 되는 순간 A기관 예약이 거기 쓰이고 B기관이 그것을 읽어온다
 * (이 파일이 막으려는 바로 그 경로). 선점 등록의 대상으로도 삼지 않는다 — 한 기관에 귀속시키면
 * 나머지 기관이 "남의 캘린더"로 차단될 뿐 원인(잘못된 입력)은 그대로 남는다.
 */
function isServiceAccountAddress(normalized: string): boolean {
    return normalized.endsWith(".gserviceaccount.com");
}

/** 캘린더 ID 정규화 — 공백·대소문자 차이로 같은 캘린더가 다른 바인딩이 되지 않게 한다. */
export function normalizeCalendarId(calendarId: string): string {
    return calendarId.trim().toLowerCase();
}

/** 바인딩 문서 ID (정규화된 캘린더 ID의 sha256 hex) */
export function calendarBindingKey(calendarId: string): string {
    return createHash("sha256").update(normalizeCalendarId(calendarId), "utf8").digest("hex");
}

/**
 * 이 캘린더의 소유 기관을 **읽기만** 한다 (미등록이면 null).
 *
 * 선점하지 않는 이유: 진단 도구(`testCalendarAccess`)가 등록까지 해버리면, 아직 동기화를
 * 돌리지 않은 기관의 캘린더 ID를 남이 버튼 몇 번으로 선점해 그 기관의 연동을 영구히
 * 막을 수 있다. 선점은 **실제로 동기화가 돌 때만** 일어나야 한다.
 */
export async function getCalendarBindingOwner(calendarId: string): Promise<string | null> {
    const snap = await getFirestore().collection(COLLECTION).doc(calendarBindingKey(calendarId)).get();
    if (!snap.exists) return null;
    return (snap.data()?.organizationId as string | undefined) ?? null;
}

/**
 * 이 기관이 이 캘린더를 써도 되는가.
 *
 * - 미등록 → 이 기관으로 선점 등록하고 true.
 * - 이 기관 소유 → true.
 * - 다른 기관 소유 → false (호출부는 캘린더 API를 호출하지 않고 건너뛴다).
 *
 * **판정 불가는 false다(fail-closed).** 조회가 실패했을 때 열어 두면 그 순간이 곧 유출
 * 창구가 된다. 캘린더 동기화는 없어도 앱이 동작하는 부가 기능이므로, 막고 나중에 다시
 * 도는 편이 항상 낫다.
 */
export async function isCalendarBoundToOrg(
    calendarId: string | null | undefined,
    organizationId: string | null | undefined,
    ctx: { logName: string; cache?: CalendarBindingCache } = { logName: "calendarBinding" },
): Promise<boolean> {
    if (!calendarId || !organizationId) return false;

    const normalized = normalizeCalendarId(calendarId);

    // 서비스 계정 주소는 어느 기관의 캘린더도 아니다 — 바인딩 조회 없이 즉시 거절한다.
    if (isServiceAccountAddress(normalized)) {
        console.error(JSON.stringify({
            severity: "ERROR",
            functionName: ctx.logName,
            message: "캘린더 ID 칸에 서비스 계정 주소가 들어와 있다 — 동기화 차단 (공유 대상 주소를 잘못 입력한 설정 오류)",
            requestedBy: organizationId,
        }));
        return false;
    }

    const key = calendarBindingKey(normalized);
    const cacheKey = `${key}:${organizationId}`;

    const cached = ctx.cache?.get(cacheKey);
    if (cached !== undefined) return cached;

    const decide = (allowed: boolean): boolean => {
        ctx.cache?.set(cacheKey, allowed);
        return allowed;
    };

    const ref = getFirestore().collection(COLLECTION).doc(key);

    try {
        const snap = await ref.get();

        if (!snap.exists) {
            // 선점 등록. create()는 문서가 이미 있으면 실패하므로, 동시 등록 경합에서
            // 뒤늦은 쪽이 남의 바인딩을 덮어쓰는 일이 없다.
            try {
                await ref.create({
                    calendarId: normalized,
                    organizationId,
                    firstBoundAt: FieldValue.serverTimestamp(),
                    boundBy: ctx.logName,
                });
                return decide(true);
            } catch {
                // 경합으로 방금 누가 만들었다 — 다시 읽어 소유자를 확인한다.
                const retry = await ref.get();
                const owner = retry.exists ? (retry.data()?.organizationId as string | undefined) : undefined;
                return decide(owner === organizationId);
            }
        }

        const owner = snap.data()?.organizationId as string | undefined;
        if (owner === organizationId) return decide(true);

        // 교차 테넌트 시도 — 캘린더 API를 부르기 전에 끊는다.
        console.error(JSON.stringify({
            severity: "ERROR",
            functionName: ctx.logName,
            message: "다른 기관에 귀속된 캘린더 ID — 동기화 차단",
            // 캘린더 ID 원문은 남기지 않는다(그 자체가 표적 정보다). 해시로 대조한다.
            calendarKey: key,
            requestedBy: organizationId,
            boundTo: owner ?? "(알 수 없음)",
        }));
        if (!alertedConflicts.has(cacheKey)) {
            if (alertedConflicts.size >= ALERTED_CONFLICTS_MAX) alertedConflicts.clear();
            alertedConflicts.add(cacheKey);
            captureWarning("다른 기관에 귀속된 캘린더 ID로 동기화가 시도됐습니다", {
                functionName: ctx.logName,
                calendarKey: key,
                requestedBy: organizationId,
                boundTo: owner ?? "(알 수 없음)",
            });
        }
        return decide(false);
    } catch (err) {
        // 조회 자체가 실패한 경우 — 캐시에 남기지 않는다(다음 실행에서 다시 판정).
        console.error(JSON.stringify({
            severity: "ERROR",
            functionName: ctx.logName,
            message: "캘린더 바인딩 확인 실패 — 동기화 건너뜀",
            calendarKey: key,
            error: (err as Error).message,
        }));
        return false;
    }
}
