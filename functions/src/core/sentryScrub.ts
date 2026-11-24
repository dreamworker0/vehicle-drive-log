/**
 * sentryScrub — Cloud Functions가 Sentry·Discord로 보내는 진단 문맥에서 개인정보를 걷어낸다.
 *
 * 설계는 프론트엔드 `src/lib/sentryScrub.ts`를 따른다.
 * - **문자열 기본 차단**: 진단에 실제로 쓰는 키만 통과시킨다. 어떤 키가 위험한지 열거하는
 *   방식(차단 목록)은 새 필드가 생길 때마다 조용히 뚫린다.
 * - 허용 키는 **일반 명사를 피한다**(`body`·`name`·`memo` 등은 자유 입력이 실릴 수 있다).
 *   진단값을 남기고 싶으면 `holidayApiBodyPreview`처럼 그 용도 전용 이름을 쓴다.
 * - 숫자·불리언·null은 남긴다. 지운 값은 **모양(타입·길이)** 을 남긴다.
 *
 * 프론트와 다른 점 하나: 허용 키의 문자열에 이메일·전화번호·사업자등록번호가 섞여 있으면
 * **그 부분만 가린다**(프론트는 값 전체를 지운다). 서버 쪽 허용 문자열은 대부분 오류 메시지·
 * 스택이라 통째로 지우면 진단이 사라진다 — `user foo@x.com not found`는
 * `user fo***@x.com not found`로 남겨도 무엇이 깨졌는지 알 수 있다.
 *
 * 실제로 막는 경로(2026-11-24 조사):
 * - `tmapProxy`가 파싱 실패 시 T맵 응답 본문(`body`)을 싣는다 — 목적지 주소가 들어 있을 수 있다.
 * - `rateLimit`이 IP(`ip`)를 싣는다.
 * - 오류 메시지·스택에 계정 이메일(캘린더 ID 포함)이 섞인다.
 */

/**
 * 값을 그대로(민감 패턴만 가린 채) 남길 키.
 *
 * 새로 추가할 때는 **일반 명사인지** 먼저 본다. 호출부가 직접 만드는 문맥이라도, 문서나 외부 응답을
 * 같은 이름에 통째로 실으면 그대로 새어 나간다.
 */
const ALLOWED_KEYS = new Set([
    // 보고 지점 라벨
    "context", "fn", "function", "functionName", "step",
    // 오류 정보 — 메시지·스택은 민감 패턴만 가린다
    "error", "cause", "stack", "code", "status",
    // 횟수·규모
    "count", "attempts", "retryCount",
    // 요청 메타(https 래퍼) — path는 쿼리를 포함하지 않는다(req.path)
    "method", "path",
    // 기간 라벨
    "year", "period",
    // 고정 코드값을 담는 전용 이름
    "action",          // auditLog: 감사 동작 코드
    "targetType",      // auditLog: 대상 문서 종류
    "outputUri",       // dailyNightlyBatch: 백업 경로(gs://)
    "samples",         // verifyDriveLogIntegrity: `log=<id> vehicleId=<id> …` 형식의 ID 목록
    "calendarKey",     // calendarBinding: 캘린더 ID — 계정 이메일이면 패턴 마스킹으로 가려진다
    "requestedBy",     // calendarBinding: 요청 기관 ID
    "boundTo",         // calendarBinding: 귀속 기관 ID
    "holidayApiBodyPreview", // syncHolidays: 공공데이터 공휴일 API 응답 앞부분(공개 데이터)
    "의미",            // dailyNightlyBatch: 운영자에게 보여 줄 고정 설명 문구
]);

/** 식별자 키(`id`, `uid`, `orgId`, `vehicleIds` …). 불투명한 문서 ID라 남긴다. */
function isIdKey(key: string): boolean {
    return /^(?:id|uid)$/.test(key) || /[a-z](?:Id|Uid|UID|Ids)$/.test(key);
}

/** 날짜·시각 키(`date`, `createdAt`, `currentTime` …). 언제 깨졌는지가 진단의 절반이다. */
function isDateKey(key: string): boolean {
    return key === "date" || /[a-z](?:Date|At|Time)$/.test(key);
}

function isSafeKey(key: string): boolean {
    return ALLOWED_KEYS.has(key) || isIdKey(key) || isDateKey(key);
}

/** 이메일 — 앞 2글자와 도메인만 남긴다(`ab***@example.com`). 도메인은 캘린더 종류 판별에 쓴다. */
const EMAIL_RE = /([^\s@"'<>(),;:]{1,2})[^\s@"'<>(),;:]*@([^\s@"'<>(),;:]+\.[^\s@"'<>(),;:]+)/g;
/** 전화번호 — 구분자를 요구해 km·문서 ID 같은 숫자 나열을 건드리지 않는다. */
const PHONE_RE = /\b(0\d{1,2})[-.\s]\d{3,4}[-.\s](\d{4})\b/g;
/** 사업자등록번호 (123-45-67890) */
const BIZNO_RE = /\b(\d{3})-(\d{2})-\d{5}\b/g;

/**
 * 문자열에 섞인 이메일·전화번호·사업자등록번호를 가린다. 나머지 글자는 그대로 둔다.
 * Discord 제목·Sentry 예외 메시지처럼 키가 없는 자유 문자열에도 쓴다.
 */
export function maskSensitiveText(text: string): string {
    if (typeof text !== "string" || !text) return text;
    return text
        .replace(EMAIL_RE, "$1***@$2")
        .replace(PHONE_RE, "$1-****-$2")
        .replace(BIZNO_RE, "$1-$2-*****");
}

/** 값을 지우되 진단에 쓰이는 모양(타입·길이)은 남긴다. */
function redact(value: unknown): string {
    if (typeof value === "string") return `[redacted string(${value.length})]`;
    if (Array.isArray(value)) return `[redacted array(${value.length})]`;
    return "[redacted]";
}

const MAX_DEPTH = 4;
const MAX_ARRAY_ITEMS = 20;
const MAX_OBJECT_KEYS = 50;

function scrubValue(value: unknown, keySafe: boolean, depth: number, path: Set<object>): unknown {
    if (value === null || value === undefined) return value;
    if (typeof value === "boolean" || typeof value === "number") return value;
    if (typeof value === "bigint") return value.toString();

    if (typeof value === "string") {
        return keySafe ? maskSensitiveText(value) : redact(value);
    }

    if (typeof value !== "object") return `[${typeof value}]`;

    // Error는 메시지가 곧 진단이라 남긴다(민감 패턴만 가린다).
    if (value instanceof Error) return maskSensitiveText(`${value.name}: ${value.message}`);
    if (value instanceof Date) return value.toISOString();

    const obj = value as object;
    if (path.has(obj)) return "[circular]";
    if (depth >= MAX_DEPTH) return "[redacted depth]";
    path.add(obj);

    try {
        if (Array.isArray(value)) {
            // 배열 원소에는 키가 없다 — 상위 키가 안전할 때만 내용을 남긴다.
            const items = value.slice(0, MAX_ARRAY_ITEMS).map(item => scrubEntry(item, keySafe, depth + 1, path));
            if (value.length > MAX_ARRAY_ITEMS) items.push(`[+${value.length - MAX_ARRAY_ITEMS} more]`);
            return items;
        }

        // Firestore Timestamp·DocumentReference 등 모르는 객체도 키 단위로 훑는다.
        const out: Record<string, unknown> = {};
        const allKeys = Object.keys(value as Record<string, unknown>);
        if (allKeys.length > MAX_OBJECT_KEYS) out["[truncated]"] = `+${allKeys.length - MAX_OBJECT_KEYS} keys`;
        for (const key of allKeys.slice(0, MAX_OBJECT_KEYS)) {
            let raw: unknown;
            try {
                raw = (value as Record<string, unknown>)[key];
            } catch {
                out[key] = "[unreadable]";
                continue;
            }
            out[key] = scrubEntry(raw, isSafeKey(key), depth + 1, path);
        }
        return out;
    } finally {
        path.delete(obj);
    }
}

/** scrubValue를 감싸 값 하나가 터져도 형제를 살린다. */
function scrubEntry(value: unknown, keySafe: boolean, depth: number, path: Set<object>): unknown {
    try {
        return scrubValue(value, keySafe, depth, path);
    } catch {
        return "[unreadable]";
    }
}

/**
 * Sentry `extra`·Discord 설명으로 보낼 문맥에서 개인정보를 걷어낸다.
 *
 * 어떤 입력에도 예외를 던지지 않는다 — 오류를 보고하다 함수가 죽으면 본말전도다.
 */
export function scrubContext(context: Record<string, unknown>): Record<string, unknown> {
    const path = new Set<object>();
    const out: Record<string, unknown> = {};
    let keys: string[];
    try {
        keys = Object.keys(context ?? {}).slice(0, MAX_OBJECT_KEYS);
    } catch {
        return { scrubFailed: true };
    }
    for (const key of keys) {
        let raw: unknown;
        try {
            raw = context[key];
        } catch {
            out[key] = "[unreadable]";
            continue;
        }
        out[key] = scrubEntry(raw, isSafeKey(key), 0, path);
    }
    return out;
}

/** Sentry 이벤트 중 beforeSend에서 손대는 부분만 추린 모양 */
export interface ScrubbableEvent {
    message?: string;
    exception?: { values?: Array<{ value?: string }> };
    extra?: Record<string, unknown>;
}

/**
 * Sentry로 나가기 직전 이벤트 전체를 한 번 더 거른다(`init`의 `beforeSend`).
 *
 * captureError가 `extra`를 미리 걸러도 **예외 메시지 본체**는 SDK가 Error에서 직접 꺼내 간다.
 * 또 captureError를 거치지 않는 SDK 자동 수집(처리되지 않은 예외 등)도 여기서 같이 잡는다.
 */
export function scrubSentryEvent<T extends ScrubbableEvent>(event: T): T {
    try {
        if (typeof event.message === "string") event.message = maskSensitiveText(event.message);
        for (const ex of event.exception?.values ?? []) {
            if (typeof ex.value === "string") ex.value = maskSensitiveText(ex.value);
        }
        if (event.extra) event.extra = scrubContext(event.extra);
    } catch {
        // 거르다 실패해도 이벤트 자체는 보낸다 — 진단을 통째로 잃는 것보다 낫다.
    }
    return event;
}
