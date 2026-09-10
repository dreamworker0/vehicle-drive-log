/**
 * sessionBoot — 부팅 시점의 세션 장부
 *
 * 여기 있는 것은 전부 **Firebase를 건드리지 않는** 로컬 표식이다. 의존성이 없어야 경량
 * 진입점(main.tsx)이 이걸 쓰면서도 firebase.ts·Sentry를 끌고 오지 않는다 — 비인증
 * 방문자의 초기 번들을 지키는 것이 lightEntry 분리의 목적이므로 이 제약이 곧 설계다.
 *
 * 담는 것은 세 가지다.
 *   ① 재방문 힌트 — appEntry를 미리 받아 둘지 정한다
 *   ② 의도적 로그아웃 표식 — "사용자가 눌렀다"와 "혼자 사라졌다"를 가른다
 *   ③ 세션 소실 증거 — ②가 아닌데 세션이 없는 채로 부팅했을 때 무엇이 남아 있었는지
 */

/**
 * 이전에 로그인한 적이 있는 브라우저인지 표시하는 힌트.
 *
 * appEntry 프리로드를 **누구에게 걸지** 정하는 데 쓴다. 인증 판정은 여전히
 * `onAuthStateChanged`가 하며, 이 값이 틀려도(로그아웃 뒤 남아 있거나 지워졌거나)
 * 화면 동작은 달라지지 않는다 — 프리로드가 한 번 헛돌거나 한 번 늦을 뿐이다.
 *
 * 아래 ③에서는 "세션이 있었어야 하는 브라우저인가"의 근거로도 쓴다.
 */
const RETURNING_VISITOR_KEY = 'vdl:returning-visitor';

export function readReturningHint(): boolean {
    try {
        return localStorage.getItem(RETURNING_VISITOR_KEY) === '1';
    } catch {
        // 시크릿 모드·저장소 차단 환경 — 첫 방문으로 취급한다(더 가벼운 쪽)
        return false;
    }
}

export function writeReturningHint(value: boolean): void {
    try {
        if (value) localStorage.setItem(RETURNING_VISITOR_KEY, '1');
        else localStorage.removeItem(RETURNING_VISITOR_KEY);
    } catch { /* 저장소를 못 쓰면 힌트 없이 동작한다 */ }
}

/**
 * 사용자가 스스로 로그아웃했음을 남기는 표시.
 *
 * **왜 필요한가.** 화면에서 보면 "의도한 로그아웃"과 "세션이 저 혼자 사라진 것"이 똑같다 —
 * 둘 다 `onAuthStateChanged(null)` 하나로 도착하고 로그인 화면으로 끝난다. 구분이 없으면
 * 후자를 보고할 수 없거나(원인 추적 불가) 전자까지 보고해서(노이즈) 둘 다 못 쓴다.
 *
 * **왜 localStorage인가.** 한 탭에서 로그아웃하면 Firebase Auth가 세션을 공유하는
 * 다른 탭도 함께 로그아웃된다. 그 탭에게도 "이건 의도된 것"이 보여야 하므로 모듈 변수로는
 * 부족하다. 스토리지가 막힌 환경(사파리 프라이빗 등)을 위해 모듈 변수를 함께 둔다 —
 * 그 경우 자기 탭에서만 구분되고, 다른 탭은 한 번 오탐 보고할 뿐 동작은 같다.
 */
const INTENTIONAL_LOGOUT_KEY = 'vdl:intentional-logout';
/** 표시가 유효한 창. 로그아웃 직후 도착하는 null 발화만 덮으면 되므로 짧게 잡는다. */
const INTENTIONAL_LOGOUT_WINDOW_MS = 10_000;

let intentionalLogoutAt = 0;

/** 의도적 로그아웃을 표시한다. signOut 직전에 부른다(발화가 먼저 오는 경우가 있다). */
export function markIntentionalLogout(): void {
    intentionalLogoutAt = Date.now();
    try {
        localStorage.setItem(INTENTIONAL_LOGOUT_KEY, String(intentionalLogoutAt));
    } catch {
        // 스토리지가 막힌 환경 — 모듈 변수만으로 자기 탭은 구분된다
    }
}

/** 방금 사용자가 스스로 로그아웃했는가. 세션 소멸을 보고할지 판단하는 데만 쓴다. */
export function wasIntentionalLogout(): boolean {
    const now = Date.now();
    if (intentionalLogoutAt && now - intentionalLogoutAt < INTENTIONAL_LOGOUT_WINDOW_MS) return true;
    try {
        const raw = localStorage.getItem(INTENTIONAL_LOGOUT_KEY);
        if (!raw) return false;
        const at = Number(raw);
        return Number.isFinite(at) && now - at < INTENTIONAL_LOGOUT_WINDOW_MS;
    } catch {
        return false;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// ③ 세션 소실 증거
// ─────────────────────────────────────────────────────────────────────────────

/** 다음 로그인 때 Sentry로 올릴 증거를 담아 두는 자리. 한 건만 유지한다. */
const SESSION_LOSS_KEY = 'vdl:session-loss';

/** 우리 앱이 localStorage에 쓰는 키들. 저장소가 통째로 비워졌는지 가늠하는 데 쓴다. */
const APP_KEY_PREFIXES = ['vdl:', 'driveLog_', 'tmap_', 'poi_search_cache_v1', 'preferred-nav-app', 'employee-welcome-dismissed', 'sw_purge_v', 'pendingInviteCode'];

export interface SessionLossEvidence {
    /** 발생 시각 (ISO) */
    at: string;
    /** 로그인한 적 있는 브라우저라는 힌트가 남아 있었나 */
    returningHint: boolean;
    /** Firebase가 세션을 넣어 두는 localStorage 키가 남아 있었나 */
    authKeyInLocalStorage: boolean;
    /** Firebase Auth의 IndexedDB(firebaseLocalStorageDb)가 있었나 */
    authDbInIndexedDB: 'yes' | 'no' | 'unsupported';
    /** 우리 앱 키 중 살아남은 개수 — 0이면 localStorage가 통째로 비워졌다는 뜻 */
    survivingAppKeys: number;
    /** localStorage 전체 키 개수 */
    localStorageKeys: number;
    /** 저장소가 축출 대상이 아닌 상태로 승격돼 있었나 (미지원 시 null) */
    persisted: boolean | null;
    /** 사용량·할당량 (MB, 미지원 시 null) */
    usageMb: number | null;
    quotaMb: number | null;
    /** 설치형(PWA)으로 열렸나 */
    standalone: boolean;
    online: boolean;
    userAgent: string;
}

function isAppKey(key: string): boolean {
    return APP_KEY_PREFIXES.some((prefix) => key.startsWith(prefix));
}

async function collectEvidence(returningHint: boolean): Promise<SessionLossEvidence> {
    let authKeyInLocalStorage = false;
    let survivingAppKeys = 0;
    let localStorageKeys = 0;
    try {
        const keys = Object.keys(localStorage);
        localStorageKeys = keys.length;
        for (const key of keys) {
            // Firebase가 쓰는 이름은 `firebase:authUser:<apiKey>:[DEFAULT]`다.
            // apiKey를 실어 보내지 않으려고 접두사만 본다.
            if (key.startsWith('firebase:authUser:')) authKeyInLocalStorage = true;
            if (isAppKey(key)) survivingAppKeys += 1;
        }
    } catch { /* 저장소가 막힌 환경 — 기본값(false/0)이 그 자체로 증거다 */ }

    let authDbInIndexedDB: SessionLossEvidence['authDbInIndexedDB'] = 'unsupported';
    try {
        // Safari·Firefox는 indexedDB.databases()를 지원하지 않는다 — 'unsupported'로 남긴다.
        const list = await indexedDB.databases?.();
        if (list) {
            authDbInIndexedDB = list.some((d) => d.name === 'firebaseLocalStorageDb') ? 'yes' : 'no';
        }
    } catch { /* 조회 실패도 'unsupported'로 둔다 */ }

    let persisted: boolean | null = null;
    let usageMb: number | null = null;
    let quotaMb: number | null = null;
    try {
        persisted = (await navigator.storage?.persisted?.()) ?? null;
        const estimate = await navigator.storage?.estimate?.();
        if (estimate) {
            usageMb = Math.round((estimate.usage ?? 0) / 1_048_576);
            quotaMb = Math.round((estimate.quota ?? 0) / 1_048_576);
        }
    } catch { /* 미지원 환경 — null로 둔다 */ }

    let standalone = false;
    try {
        standalone = typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches;
    } catch { /* matchMedia 미구현 환경 — false로 둔다 */ }

    return {
        at: new Date().toISOString(),
        returningHint,
        authKeyInLocalStorage,
        authDbInIndexedDB,
        survivingAppKeys,
        localStorageKeys,
        persisted,
        usageMb,
        quotaMb,
        standalone,
        online: typeof navigator !== 'undefined' ? navigator.onLine : true,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 200) : '',
    };
}

/**
 * 세션 없이 부팅했는데 **세션이 있었어야 하는 브라우저**라면 증거를 적어 둔다.
 *
 * **왜 여기서 바로 Sentry로 보내지 않나.** 이 시점은 경량 진입점이라 Sentry가 초기화돼
 * 있지 않다. 여기서 올리려면 랜딩 화면에 @sentry/react를 통째로 끌어와야 하는데, 그건
 * lightEntry 분리로 아낀 것을 그대로 되돌리는 일이다. 사용자는 어차피 곧 다시 로그인하므로
 * 그때 appEntry가 `takePendingSessionLoss()`로 집어 올린다.
 *
 * **왜 이 계측이 필요한가.** 앱이 켜져 있는 동안 끊기는 경우는 useAuth가 원인까지 분류해
 * 보고하지만, "껐다 켰더니 로그인 화면"은 main.tsx가 조용히 경량 진입점을 띄우고 끝이라
 * 지금까지 어디에도 남지 않았다 — 휴대폰 PWA 제보가 정확히 그 모양이었다.
 */
export function recordSessionLossIfSuspicious(): void {
    // 힌트는 **동기적으로** 먼저 읽는다 — 호출자가 곧바로 힌트를 내리기 때문이다.
    const returningHint = readReturningHint();
    if (!returningHint) return;
    if (wasIntentionalLogout()) return;

    collectEvidence(returningHint)
        .then((evidence) => {
            try {
                localStorage.setItem(SESSION_LOSS_KEY, JSON.stringify(evidence));
            } catch { /* 적어 둘 곳이 없으면 이번 건은 포기한다 */ }
        })
        .catch(() => { /* 증거 수집 실패로 부팅을 방해하지 않는다 */ });
}

/** 적어 둔 증거를 꺼내고 지운다. 없으면 null. */
export function takePendingSessionLoss(): SessionLossEvidence | null {
    let raw: string | null = null;
    try {
        raw = localStorage.getItem(SESSION_LOSS_KEY);
        if (raw) localStorage.removeItem(SESSION_LOSS_KEY);
    } catch {
        return null;
    }
    if (!raw) return null;
    try {
        return JSON.parse(raw) as SessionLossEvidence;
    } catch {
        return null;
    }
}
