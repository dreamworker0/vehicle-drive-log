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

// ─── breadcrumb 전용 ───

/**
 * 쿼리 값을 그대로 남길 파라미터 이름.
 *
 * ⚠️ ALLOWED_KEYS와 같은 주의가 여기에도 걸린다 — **일반 명사는 넣지 않는다.** 이 목록은
 * 이 앱이 부르는 URL만이 아니라 SDK가 보는 **모든** URL(제3자 호스트 포함)에 적용되므로,
 * 어딘가에서 같은 이름에 자유 입력을 실으면 그대로 새어 나간다. 아래 이름들은 현재 전부
 * 고정 코드값이다(`action`은 poi·geocode·route 세 가지, 나머지는 리터럴·숫자).
 */
const SAFE_QUERY_PARAMS = new Set([
    'action', 'version', 'format', 'count',
    'resCoordType', 'reqCoordType',
]);

/**
 * URL에서 사람이 친 값을 걷어낸다. 경로와 파라미터 **이름**은 남긴다.
 *
 * fetch·xhr breadcrumb은 URL을 통째로 담는데, 이 앱은 목적지 검색을 쿼리로 보낸다.
 * 그래서 captureError의 extra를 아무리 걸러도 그 직전 요청의 breadcrumb으로 목적지가 따라 나갔다.
 */
export function scrubUrl(rawUrl: string): string {
    if (typeof rawUrl !== 'string' || !rawUrl) return rawUrl;
    // 쿼리도 프래그먼트도 없으면 건드릴 것이 없다(대다수 요청).
    if (!rawUrl.includes('?') && !rawUrl.includes('#')) return rawUrl;

    const [beforeHash] = rawUrl.split('#');
    // 프래그먼트만 있는 값(`#frag`)은 지우면 빈 문자열이 된다 — 원본보다 나쁘다.
    if (!beforeHash) return rawUrl;
    const qIndex = beforeHash.indexOf('?');
    if (qIndex === -1) return beforeHash;

    const path = beforeHash.slice(0, qIndex);
    const query = beforeHash.slice(qIndex + 1);
    if (!query) return path;

    const safe = query.split('&').map(pair => {
        const eq = pair.indexOf('=');
        if (eq === -1) return pair;
        const key = pair.slice(0, eq);
        if (SAFE_QUERY_PARAMS.has(key)) return pair;
        // 값의 길이는 남긴다 — 빈 검색어와 긴 검색어는 다른 증상이다.
        return `${key}=[redacted(${pair.length - eq - 1})]`;
    });
    return `${path}?${safe.join('&')}`;
}

/**
 * 사람이 읽는 텍스트를 담는 HTML 속성. SDK가 **설정과 무관하게 항상** 붙인다
 * (@sentry/core utils/browser.js `_htmlElementAsString`의 고정 목록).
 *
 * 이 앱은 여기에 실명을 넣는다 — `title="공동 운전자: 홍길동, 김철수"`,
 * `aria-label="홍길동 제거"`. 접근성과 도움말에 필요한 값이라 화면에서 뺄 수는 없다.
 * 그래서 나가는 길목에서 값만 지운다. `type`·`name`은 입력 칸의 식별자라 남긴다.
 */
const PII_BEARING_ATTRS = ['aria-label', 'title', 'alt'] as const;

/**
 * DOM breadcrumb의 요소 설명에서 사람이 읽는 속성값을 지운다.
 *
 * 속성이 있었다는 사실은 남긴다(`[title]`) — 어느 요소를 눌렀는지 좁히는 데 쓰이고,
 * 태그·id·클래스는 그대로라 진단이 통째로 사라지지 않는다.
 */
export function scrubDomTarget(target: string): string {
    if (typeof target !== 'string' || !target) return target;
    let out = target;
    for (const attr of PII_BEARING_ATTRS) {
        // 값 안에 `"]`가 들어갈 수 있다 — SDK는 속성값의 따옴표를 escape하지 않는다
        // (@sentry/core htmlTreeAsString). 그래서 첫 `"]`에서 끊으면 그 뒤 꼬리가 그대로
        // 남고, 마지막 `"]`까지 버리면 뒤따르는 멀쩡한 속성이 함께 사라진다.
        // 값의 끝을 **경계로** 판정한다: 문자열 끝, 요소 구분자(` > `), 또는 SDK가 이어 붙이는
        // 다음 속성. 셋 중 무엇도 오지 않으면 짝이 깨진 것이라 끝까지 버린다(fail-closed).
        const boundary = String.raw`(?=$|\s>\s|\[(?:aria-label|type|name|title|alt)=")`;
        out = out.replace(new RegExp(String.raw`\[${attr}="[\s\S]*?"\]` + boundary, 'g'), `[${attr}]`);
        // 경계를 못 찾은 잔여분(닫히지 않았거나 값에 `"]`가 섞여 경계 판정이 실패한 경우)
        const orphan = out.indexOf(`[${attr}="`);
        if (orphan !== -1) out = `${out.slice(0, orphan)}[${attr}]`;
    }
    return out;
}


/**
 * 스팬 속성에서 URL을 담는 키 — SDK가 요청마다 채운다.
 *
 * `getFetchSpanAttributes`(@sentry/core)가 `url`에 **원본 URL을 통째로**, `http.query`에
 * 쿼리 문자열을 그대로 넣는다. 위생 처리를 거치는 것은 스팬 **이름**(`GET /api/tmap`)뿐이다.
 */
const SPAN_URL_KEYS = ['url', 'http.url', 'url.full'] as const;

/**
 * 스팬 데이터에서 사람이 친 값을 걷어낸다.
 *
 * breadcrumb만 막아서는 부족하다. 추적(browserTracing)이 켜져 있으면 **같은 목적지 검색어가
 * 스팬 속성으로 한 번 더 나간다.** 그쪽은 `beforeBreadcrumb`이 보지 못하고, 트랜잭션 이벤트라
 * `beforeSend`도 타지 않는다(`beforeSend`는 오류 이벤트에만 걸린다).
 *
 * @returns 걸러낸 새 객체. 바꿀 것이 없으면 받은 객체를 그대로 돌려준다.
 */
export function scrubSpanData(data: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
    if (!data) return data;
    let changed = false;
    const out: Record<string, unknown> = { ...data };

    for (const key of SPAN_URL_KEYS) {
        const value = out[key];
        if (typeof value === 'string') {
            const safe = scrubUrl(value);
            if (safe !== value) { out[key] = safe; changed = true; }
        }
    }
    // 쿼리·프래그먼트는 통째로 사람이 친 값이라 스크럽할 구조가 없다. 있었다는 사실만 남긴다.
    for (const key of ['http.query', 'http.fragment']) {
        if (typeof out[key] === 'string' && out[key]) {
            out[key] = `[redacted(${(out[key] as string).length})]`;
            changed = true;
        }
    }
    return changed ? out : data;
}
