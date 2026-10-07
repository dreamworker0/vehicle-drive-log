/**
 * sessionBoot — 부팅 시점의 세션 장부
 *
 * 여기 있는 것은 전부 **Firebase를 건드리지 않는** 로컬 표식이다. 의존성이 없어야 경량
 * 진입점(main.tsx)이 이걸 쓰면서도 firebase.ts·Sentry를 끌고 오지 않는다 — 비인증
 * 방문자의 초기 번들을 지키는 것이 lightEntry 분리의 목적이므로 이 제약이 곧 설계다.
 *
 * 담는 것은 세 가지다.
 *   ① 재방문 표식 — appEntry를 미리 받아 둘지 정하고, "세션이 있었어야 하는 기기"인지 가른다
 *   ② 의도적 로그아웃 표식 — "사용자가 눌렀다"와 "혼자 사라졌다"를 가른다
 *   ③ 세션 소실 증거 — ②가 아닌데 세션 없이 부팅했을 때 무엇이 남아 있었는지
 */

// ─────────────────────────────────────────────────────────────────────────────
// ① 재방문 표식 — 성질이 다른 저장소 두 곳에 남긴다
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 이전에 로그인한 적이 있는 브라우저인지 표시하는 힌트.
 *
 * appEntry 프리로드를 **누구에게 걸지** 정하는 데 쓴다. 인증 판정은 여전히
 * `onAuthStateChanged`가 하며, 이 값이 틀려도(로그아웃 뒤 남아 있거나 지워졌거나)
 * 화면 동작은 달라지지 않는다 — 프리로드가 한 번 헛돌거나 한 번 늦을 뿐이다.
 */
const RETURNING_VISITOR_KEY = 'vdl:returning-visitor';

/**
 * 같은 사실을 쿠키에도 남긴다. **저장소가 통째로 비워진 경우를 보려면 이게 있어야 한다.**
 *
 * 휴대폰에서 세션이 사라지는 가장 유력한 경로는 브라우저의 저장소 축출인데, 그때
 * localStorage와 IndexedDB가 **함께** 비워진다. 위 힌트도 localStorage에 있으니 같이 사라지고,
 * 그러면 그 부팅은 "처음 온 사람"과 구분되지 않는다 — 정작 보고 싶은 사건만 관측하지 못한다.
 * 쿠키는 용량 축출의 대상이 아니라서(사이트 데이터 삭제·ITP는 별개 경로다) 그 구분이 된다.
 *
 * 값은 `1` 하나뿐이고 개인정보가 없다. 로그아웃 때는 힌트와 함께 지운다.
 */
const RETURNING_VISITOR_COOKIE = 'vdl_seen';
const RETURNING_COOKIE_MAX_AGE = 60 * 60 * 24 * 730; // 2년

function readCookieMark(): boolean {
    try {
        return document.cookie.split('; ').some((entry) => entry === RETURNING_VISITOR_COOKIE + '=1');
    } catch {
        return false;
    }
}

function writeCookieMark(value: boolean): void {
    try {
        const secure = location.protocol === 'https:' ? '; Secure' : '';
        const common = '; Path=/; SameSite=Lax' + secure;
        document.cookie = value
            ? RETURNING_VISITOR_COOKIE + '=1; Max-Age=' + RETURNING_COOKIE_MAX_AGE + common
            : RETURNING_VISITOR_COOKIE + '=; Max-Age=0' + common;
    } catch { /* 쿠키를 못 쓰면 힌트만으로 동작한다 */ }
}

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
    writeCookieMark(value);
}

// ─────────────────────────────────────────────────────────────────────────────
// ② 의도적 로그아웃 표식
// ─────────────────────────────────────────────────────────────────────────────

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

/**
 * 세션이 끝났음을 장부에 반영한다 — 의도적 로그아웃이든, 앱이 관측해 이미 보고한 종료든.
 *
 * 표식을 남겨 두면 **다음 부팅에서 같은 사건이 '세션 소실'로 한 번 더** 올라간다.
 * 계정 비활성화·소속 변경처럼 서버가 끊은 세션이 특히 그렇다 — useAuth가 원인까지 붙여
 * 이미 보고한 사건이, 원인 없는 이름으로 중복 기록된다.
 */
export function clearSessionMarkers(): void {
    writeReturningHint(false);
}

// ─────────────────────────────────────────────────────────────────────────────
// ③ 세션 소실 증거
// ─────────────────────────────────────────────────────────────────────────────

/** 다음 로그인 때 Sentry로 올릴 증거를 담아 두는 자리. 한 건만 유지한다. */
const SESSION_LOSS_KEY = 'vdl:session-loss';

/**
 * 예전 빌드가 세션을 두던 localStorage 키의 접두사 (`firebase:authUser:<apiKey>:[DEFAULT]`).
 *
 * 있고 없고만 본다 — 값은 읽지도, 어디에도 싣지도 않는다. 필드 이름에 `authKey`를 쓰면
 * CodeQL(js/clear-text-storage-of-sensitive-data)이 이름만 보고 자격증명을 저장하는 것으로
 * 읽으므로, 사실 그대로 "예전 사본"이라고 부른다.
 */
const LEGACY_LOCAL_COPY_PREFIX = 'firebase:authUser:';

/** 우리 앱이 localStorage에 쓰는 키들. 저장소가 얼마나 남았는지 가늠하는 데 쓴다. */
const APP_KEY_PREFIXES = ['vdl:', 'driveLog_', 'tmap_', 'poi_search_cache_v1', 'preferred-nav-app', 'employee-welcome-dismissed', 'sw_purge_v', 'pendingInviteCode'];

interface BootSnapshot {
    returningHint: boolean;
    cookieMark: boolean;
    /** 예전 빌드가 localStorage에 두던 세션 사본이 남아 있었나 */
    legacyLocalCopy: boolean;
    /** 우리 앱 키 중 살아남은 개수 (재방문 힌트는 세지 않는다 — 0이 의미를 갖게) */
    appKeys: number;
    localStorageKeys: number;
}

function takeBootSnapshot(): BootSnapshot {
    const snapshot: BootSnapshot = {
        returningHint: false,
        cookieMark: readCookieMark(),
        legacyLocalCopy: false,
        appKeys: 0,
        localStorageKeys: 0,
    };
    try {
        const keys = Object.keys(localStorage);
        snapshot.localStorageKeys = keys.length;
        for (const key of keys) {
            if (key === RETURNING_VISITOR_KEY) {
                snapshot.returningHint = localStorage.getItem(key) === '1';
                continue;
            }
            if (key.startsWith(LEGACY_LOCAL_COPY_PREFIX)) snapshot.legacyLocalCopy = true;
            if (APP_KEY_PREFIXES.some((prefix) => key.startsWith(prefix))) snapshot.appKeys += 1;
        }
    } catch { /* 저장소가 막힌 환경 — 기본값이 그 자체로 증거다 */ }
    return snapshot;
}

/**
 * 부팅 직후의 저장소 모습. **모듈 평가 시점에 동기적으로** 찍는다.
 *
 * **왜 그때인가.** Firebase Auth는 초기화 중에 저장소를 바꿔 놓는다 —
 * `PersistenceUserManager.create`가 1순위가 아닌 저장소에서 세션 키를 **지우고**,
 * IndexedDB 가용성 검사가 `firebaseLocalStorageDb`를 **만든다**. 그 뒤에 읽으면
 * "localStorage에 세션이 있었나"는 언제나 아니오가 되어 증거가 상수로 굳는다.
 * SDK의 그 정리는 전부 마이크로태스크 뒤에서 일어나므로 동기 스냅숏이 반드시 앞선다.
 */
const bootSnapshot = takeBootSnapshot();

/**
 * Sentry로 올릴 증거.
 *
 * **전부 숫자·불리언이다.** 문자열은 `sentryScrub`의 기본 차단에 걸려 `[redacted string(n)]`로
 * 바뀐다 — 허용 목록은 자유 입력이 새는 것을 막으려고 일부러 좁게 두었으므로, 진단값을
 * 문자열로 실으면 도착하지 않는다. 기기·브라우저 종류는 Sentry가 자체 컨텍스트로 붙인다.
 */
export interface SessionLossEvidence {
    /** 기록 시각 (epoch ms) */
    at: number;
    /** localStorage의 재방문 힌트가 남아 있었나 */
    returningHint: boolean;
    /** 쿠키 표식이 남아 있었나 — 힌트가 없는데 이게 있으면 저장소가 통째로 비워진 것이다 */
    cookieMark: boolean;
    /** 예전 빌드가 localStorage에 두던 세션 사본이 남아 있었나 */
    legacyLocalCopy: boolean;
    /** 우리 앱 키 중 살아남은 개수(힌트 제외). 0이면 localStorage가 비워졌다는 뜻 */
    appKeys: number;
    localStorageKeys: number;
    /** 저장소가 축출 대상이 아닌 상태로 승격돼 있었나 (미지원 시 null) */
    persisted: boolean | null;
    usageMb: number | null;
    quotaMb: number | null;
    /** 설치형(PWA)으로 열렸나 */
    standalone: boolean;
    online: boolean;
}

async function collectEvidence(): Promise<SessionLossEvidence> {
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
        at: Date.now(),
        returningHint: bootSnapshot.returningHint,
        cookieMark: bootSnapshot.cookieMark,
        legacyLocalCopy: bootSnapshot.legacyLocalCopy,
        appKeys: bootSnapshot.appKeys,
        localStorageKeys: bootSnapshot.localStorageKeys,
        persisted,
        usageMb,
        quotaMb,
        standalone,
        online: typeof navigator !== 'undefined' ? navigator.onLine : true,
    };
}

/**
 * 세션 없이 부팅했다 — 표식을 정리하고, 세션이 있었어야 하는 기기였다면 증거를 적어 둔다.
 *
 * 정리와 판정을 **한 함수에 묶은 것이 요점**이다. 호출부에서 "먼저 판정하고 그 다음 표식을
 * 내린다"로 나누면 두 줄의 순서가 계약이 되는데, 뒤바꿔도 타입도 테스트도 통과하고 계측만
 * 조용히 죽는다. 판정 근거는 부팅 스냅숏이라 정리를 먼저 해도 결과가 달라지지 않는다.
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
export function noteUnauthenticatedBoot(): void {
    const hadSession = bootSnapshot.returningHint || bootSnapshot.cookieMark;
    // 다음 방문도 가볍게 연다(그리고 이 판정이 다음 부팅에서 되풀이되지 않게 한다)
    clearSessionMarkers();

    if (!hadSession) return;
    if (wasIntentionalLogout()) return;

    collectEvidence()
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
