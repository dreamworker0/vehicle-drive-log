/**
 * sentryScrub — Sentry `extra`에 실리는 진단 컨텍스트에서 개인정보를 걷어낸다.
 *
 * 도메인 함수 20여 곳이 실패를 보고할 때 `captureError(error, { context: 'createX', data })`
 * 처럼 **저장하려던 문서를 통째로** 넘긴다. 그 안에는 목적지·동승자 이름·비고·기관명 같은
 * 자유 입력이 들어 있다. 호출부를 하나씩 고치면 새 도메인 파일이 생길 때 같은 실수가
 * 다시 나므로, 보내기 직전 한 곳(captureError/captureWarning)에서 거른다.
 *
 * 방침은 **문자열 기본 차단**이다 — 자유 입력은 거의 전부 문자열이고, 어떤 키가 위험한지
 * 열거하는 방식(차단 목록)은 새 필드가 추가될 때마다 조용히 뚫린다. 그래서 반대로
 * 진단에 실제로 쓰는 키만 통과시킨다.
 *
 * 숫자·불리언은 남긴다. km·건수·금액·플래그처럼 문제를 좁히는 데 꼭 필요하고, 라벨 없는
 * 수치 자체로는 개인을 식별하지 못한다. 값을 지울 때도 **모양은 남긴다**(타입과 길이) —
 * "빈 문자열이라 실패했는지, 200자라 실패했는지"가 진단의 핵심인 경우가 많다.
 *
 * 이 모듈이 다루는 것은 `extra`뿐이다. Sentry `user`(uid·email·역할)는 사용자를 식별하려고
 * 의도적으로 넣는 값이라 건드리지 않고, SDK가 자동 수집하는 breadcrumb도 대상이 아니다.
 */

/** 값을 그대로 남길 키. 진단에 쓰는 라벨·코드·분류값만. */
const ALLOWED_KEYS = new Set([
    'context',
    'code',
    'errorCode',
    'status',
    'statusCode',
    'reason',
    'step',
    'key',
    'collection',
    'operation',
    'method',
    'type',
    'level',
    'attempt',
    'retryCount',
    'count',
    // 기관 식별자를 `org`로 줄여 넘기는 호출부가 있다(submitDriveLog).
    'org',
    // React 에러 경계가 넘기는 컴포넌트 트리 — 코드 구조라 개인정보가 아니고 진단의 핵심이다.
    'componentStack',
]);

/** 식별자 키(`id`, `uid`, `logId`, `orgId`, `vehicleId` …). 불투명한 문서 ID라 남긴다. */
function isIdKey(key: string): boolean {
    return /^(?:id|uid)$/.test(key) || /[a-z](?:Id|Uid|UID|Ids)$/.test(key);
}

/** 날짜 키(`date`, `startDate`, `createdAt` …). 언제 깨졌는지가 진단의 절반이다. */
function isDateKey(key: string): boolean {
    return key === 'date' || /[a-z](?:Date|At)$/.test(key);
}

function isSafeKey(key: string): boolean {
    return ALLOWED_KEYS.has(key) || isIdKey(key) || isDateKey(key);
}

/** 값을 지우되 진단에 쓰이는 모양(타입·길이)은 남긴다. */
function redact(value: unknown): string {
    if (typeof value === 'string') return `[redacted string(${value.length})]`;
    if (Array.isArray(value)) return `[redacted array(${value.length})]`;
    return '[redacted]';
}

const MAX_DEPTH = 4;
const MAX_ARRAY_ITEMS = 20;
const MAX_OBJECT_KEYS = 50;

function scrubValue(value: unknown, keySafe: boolean, depth: number, seen: WeakSet<object>): unknown {
    // 내용이 없는 값은 그대로 — 개인정보가 실릴 수 없다.
    if (value === null || value === undefined) return value;
    if (typeof value === 'boolean' || typeof value === 'number') return value;

    if (typeof value === 'string') {
        return keySafe ? value : redact(value);
    }

    // 함수·심볼 등은 직렬화 의미가 없다.
    if (typeof value !== 'object') return `[${typeof value}]`;

    // Error는 메시지가 곧 진단이라 남긴다(스택은 Sentry가 예외 본체에서 따로 가져간다).
    if (value instanceof Error) return `${value.name}: ${value.message}`;
    if (value instanceof Date) return value.toISOString();

    const obj = value as object;
    if (seen.has(obj)) return '[circular]';
    if (depth >= MAX_DEPTH) return '[redacted depth]';
    seen.add(obj);

    if (Array.isArray(value)) {
        const items = value.slice(0, MAX_ARRAY_ITEMS)
            // 배열 원소에는 키가 없다 — 상위 키가 안전할 때만 내용을 남긴다.
            .map(item => scrubValue(item, keySafe, depth + 1, seen));
        if (value.length > MAX_ARRAY_ITEMS) items.push(`[+${value.length - MAX_ARRAY_ITEMS} more]`);
        return items;
    }

    // Firestore Timestamp·FieldValue 등 우리가 모르는 객체도 키 단위로 훑는다.
    const entries = Object.entries(value as Record<string, unknown>).slice(0, MAX_OBJECT_KEYS);
    const out: Record<string, unknown> = {};
    for (const [k, v] of entries) {
        out[k] = scrubValue(v, isSafeKey(k), depth + 1, seen);
    }
    return out;
}

/**
 * Sentry `extra`로 보낼 컨텍스트에서 자유 입력을 걷어낸다.
 *
 * 어떤 입력에도 예외를 던지지 않는다 — 진단을 보내려다 앱이 죽으면 본말전도다.
 */
export function scrubContext(context: Record<string, unknown>): Record<string, unknown> {
    try {
        const seen = new WeakSet<object>();
        const out: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(context).slice(0, MAX_OBJECT_KEYS)) {
            out[key] = scrubValue(value, isSafeKey(key), 0, seen);
        }
        return out;
    } catch {
        return { scrubFailed: true };
    }
}
