/**
 * sentryScrub — Sentry로 나가는 진단 컨텍스트에서 개인정보를 걷어낸다.
 *
 * 도메인 함수 20여 곳이 실패를 보고할 때 `captureError(error, { context: 'createX', data })`
 * 처럼 **저장하려던 문서를 통째로** 넘긴다. 그 안에는 목적지·동승자 이름·비고·폐차 사유 같은
 * 자유 입력이 들어 있다. 호출부를 하나씩 고치면 새 도메인 파일이 생길 때 같은 실수가
 * 다시 나므로, 보내기 직전 한 곳에서 거른다.
 *
 * 방침은 **문자열 기본 차단**이다 — 자유 입력은 거의 전부 문자열이고, 어떤 키가 위험한지
 * 열거하는 방식(차단 목록)은 새 필드가 추가될 때마다 조용히 뚫린다. 그래서 반대로
 * 진단에 실제로 쓰는 키만 통과시킨다.
 *
 * 허용 키는 **일반 명사를 피한다.** `reason`·`type`·`key` 같은 이름은 어떤 문서에든 같은
 * 이름의 자유 입력 필드가 생길 수 있어, 허용 목록 자체가 차단 목록과 같은 방식으로 뚫린다.
 * 실제로 `retireVehicle`의 `reason`은 관리자가 입력하는 폐차 사유 원문이었다.
 * 진단값을 남기고 싶으면 `appCheckCode`처럼 **그 용도 전용 이름**을 쓴다.
 *
 * 허용 키라도 값이 이메일·전화번호·사업자등록번호 모양이면 지운다. `googleCalendarId`처럼
 * "ID로 끝나지만 실제로는 계정 이메일"인 필드가 있어서, 키 이름만으로는 부족하다.
 *
 * 숫자·불리언은 남긴다. km·건수·금액·플래그처럼 문제를 좁히는 데 꼭 필요하고, 라벨 없는
 * 수치 자체로는 개인을 식별하지 못한다. 값을 지울 때도 **모양은 남긴다**(타입과 길이) —
 * "빈 문자열이라 실패했는지, 200자라 실패했는지"가 진단의 핵심인 경우가 많다.
 *
 * Sentry `user`(uid·email·역할)는 사용자를 식별하려고 의도적으로 넣는 값이라 대상이 아니다.
 * SDK가 console 호출에서 자동 수집하는 breadcrumb은 sentry.ts의 `beforeBreadcrumb`이
 * 이 함수를 태워 거른다.
 */

/**
 * 값을 그대로 남길 키.
 *
 * 새로 추가할 때는 **일반 명사인지** 먼저 본다. 도메인 문서에 같은 이름의 자유 입력이
 * 생길 수 있는 이름(`reason`, `type`, `key`, `title`, `name`, `memo` …)은 넣지 않는다.
 */
const ALLOWED_KEYS = new Set([
    // 보고 지점 라벨과 오류 코드
    'context',
    'code',
    'appCheckCode',
    'status',
    // 재시도·횟수
    'retryCount',
    // 기관 식별자를 `org`로 줄여 넘기는 호출부가 있다(submitDriveLog).
    'org',
    // React 에러 경계가 넘기는 컴포넌트 트리 — 코드 구조라 개인정보가 아니고 진단의 핵심이다.
    'componentStack',
    // 아래는 모두 고정 코드값을 담는 전용 이름이다(자유 입력이 들어올 수 없다).
    'scope',          // useAuth: App Check 차단이 발생한 구간
    'dataset',        // recordExport: 'driveLogs' 등
    'format',         // recordExport: 'pdf' | 'excel'
    'requirement',    // useConsentGate: 'admin' | 'employee' | 'none'
    'visibility',     // document.visibilityState
    'retryKey',       // useRetry: 액션 라벨
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

/**
 * 허용 키에 실려도 내보내면 안 되는 값의 모양.
 *
 * 전화번호는 구분자를 요구해 숫자 나열(주행거리, 결정론적 문서 ID 등)을 잘못 지우지 않게 한다.
 */
const SENSITIVE_VALUE_PATTERNS: ReadonlyArray<RegExp> = [
    /[^\s@]+@[^\s@]+\.[^\s@]+/,          // 이메일
    /\b0\d{1,2}[-.\s]\d{3,4}[-.\s]\d{4}\b/, // 전화번호 (010-1234-5678)
    /\b\d{3}-\d{2}-\d{5}\b/,             // 사업자등록번호 (123-45-67890)
];

function looksSensitive(value: string): boolean {
    return SENSITIVE_VALUE_PATTERNS.some(pattern => pattern.test(value));
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

function scrubValue(value: unknown, keySafe: boolean, depth: number, path: Set<object>): unknown {
    // 내용이 없는 값은 그대로 — 개인정보가 실릴 수 없다.
    if (value === null || value === undefined) return value;
    if (typeof value === 'boolean' || typeof value === 'number') return value;

    if (typeof value === 'string') {
        return keySafe && !looksSensitive(value) ? value : redact(value);
    }

    // 함수·심볼 등은 직렬화 의미가 없다.
    if (typeof value !== 'object') return `[${typeof value}]`;

    // Error는 메시지가 곧 진단이라 남긴다(스택은 Sentry가 예외 본체에서 따로 가져간다).
    if (value instanceof Error) {
        const summary = `${value.name}: ${value.message}`;
        return looksSensitive(summary) ? redact(summary) : summary;
    }
    if (value instanceof Date) return value.toISOString();

    const obj = value as object;
    // 지금 내려온 **경로**에 같은 객체가 있을 때만 순환이다. 형제 자리에 같은 객체가
    // 두 번 나오는 것은 순환이 아니므로, 재귀가 끝나면 경로에서 뺀다.
    if (path.has(obj)) return '[circular]';
    if (depth >= MAX_DEPTH) return '[redacted depth]';
    path.add(obj);

    try {
        if (Array.isArray(value)) {
            const items = value.slice(0, MAX_ARRAY_ITEMS)
                // 배열 원소에는 키가 없다 — 상위 키가 안전할 때만 내용을 남긴다.
                .map(item => scrubEntry(item, keySafe, depth + 1, path));
            if (value.length > MAX_ARRAY_ITEMS) items.push(`[+${value.length - MAX_ARRAY_ITEMS} more]`);
            return items;
        }

        // Firestore Timestamp·FieldValue 등 우리가 모르는 객체도 키 단위로 훑는다.
        const out: Record<string, unknown> = {};
        const allKeys = Object.keys(value as Record<string, unknown>);
        if (allKeys.length > MAX_OBJECT_KEYS) out['[truncated]'] = `+${allKeys.length - MAX_OBJECT_KEYS} keys`;
        for (const key of allKeys.slice(0, MAX_OBJECT_KEYS)) {
            // getter가 던질 수 있다 — 값 하나 때문에 형제까지 잃지 않는다.
            let raw: unknown;
            try {
                raw = (value as Record<string, unknown>)[key];
            } catch {
                out[key] = '[unreadable]';
                continue;
            }
            out[key] = scrubEntry(raw, isSafeKey(key), depth + 1, path);
        }
        return out;
    } finally {
        path.delete(obj);
    }
}

/** scrubValue를 감싸 어떤 값 하나가 터져도 형제를 살린다. */
function scrubEntry(value: unknown, keySafe: boolean, depth: number, path: Set<object>): unknown {
    try {
        return scrubValue(value, keySafe, depth, path);
    } catch {
        return '[unreadable]';
    }
}

/**
 * Sentry로 보낼 컨텍스트에서 자유 입력을 걷어낸다.
 *
 * 어떤 입력에도 예외를 던지지 않는다 — 진단을 보내려다 앱이 죽으면 본말전도다.
 */
export function scrubContext(context: Record<string, unknown>): Record<string, unknown> {
    const path = new Set<object>();
    const out: Record<string, unknown> = {};
    let keys: string[];
    try {
        keys = Object.keys(context).slice(0, MAX_OBJECT_KEYS);
    } catch {
        return { scrubFailed: true };
    }
    for (const key of keys) {
        let raw: unknown;
        try {
            raw = context[key];
        } catch {
            out[key] = '[unreadable]';
            continue;
        }
        out[key] = scrubEntry(raw, isSafeKey(key), 0, path);
    }
    return out;
}

/**
 * console breadcrumb의 인자 목록을 거른다.
 *
 * `extra`와 규칙이 다르다. 여기 문자열은 대부분 개발자가 쓴 로그 문구
 * (`'[submitDriveLog] 하이패스 잔액 업데이트 실패:'`)라, extra처럼 전부 지우면
 * breadcrumb 자취가 통째로 `[redacted string(N)]`이 되어 아무 쓸모가 없어진다.
 * 그래서 **객체·배열은 extra와 같은 규칙으로 훑되**(문서 덤프가 여기로 샌다),
 * 문자열은 이메일·전화번호·사업자등록번호 모양일 때만 지운다.
 *
 * 이 규칙은 로그 문구에 섞인 이름·주소 같은 자유 입력까지 잡지는 못한다.
 * console에 원문을 찍는 호출부가 있으면 그 호출부를 고치는 것이 정답이다.
 */
export function scrubConsoleArgs(values: unknown[]): unknown[] {
    const path = new Set<object>();
    return values.slice(0, MAX_ARRAY_ITEMS).map(value => {
        if (typeof value === 'string') return looksSensitive(value) ? redact(value) : value;
        return scrubEntry(value, false, 0, path);
    });
}

/**
 * 걸러낸 인자로 breadcrumb `message`를 다시 만든다.
 *
 * SDK는 같은 인자로 `data.arguments`와 `message`(= `safeJoin(args, ' ')`)를 **둘 다** 만들고,
 * Sentry 화면이 보여 주는 것은 `message`다. 인자만 걸러 두면 개인정보는 message로 그대로
 * 나가고 진단만 사라지는, 정확히 반대인 결과가 된다.
 */
export function joinConsoleArgs(values: unknown[]): string {
    return values
        .map(value => {
            if (typeof value === 'string') return value;
            try {
                return JSON.stringify(value) ?? String(value);
            } catch {
                return '[unserializable]';
            }
        })
        .join(' ');
}
