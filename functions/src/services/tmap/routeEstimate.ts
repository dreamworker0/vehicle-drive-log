/**
 * routeEstimate — 메신저 어시스턴트용 TMAP 편도 소요시간 추정 (서버)
 *
 * 앱의 예약 화면(useRouteInfo → getMultiRouteWithFreeRoad)이 하는 일을 봇에서 재현한다:
 * 기관 주소(출발) → 목적지 경로의 편도 소요시간을 구해, 종료 시간을 자동 계산한다.
 * 실패(주소 미등록·지오코딩 실패·TMAP 오류)하면 null을 반환하고, 호출부가 종료 시간을 되묻는다.
 *
 * 단순화(파일럿): 단일 목적지, carType='0'(승용 기본). 다중 경유지·차종별 통행료는 앱에서.
 */
import { defineString } from "firebase-functions/params";
import { getFirestore } from "firebase-admin/firestore";
import { createHash } from "node:crypto";
import { log } from "../../utils/helpers";

const TMAP_API_KEY = defineString("TMAP_API_KEY");
const TMAP_BASE = "https://apis.openapi.sk.com";

interface Coord {
    lon: number;
    lat: number;
}

/** 출발지 — 좌표를 이미 아는 경우(기관 문서의 lat/lng) 지오코딩을 건너뛴다 */
export interface OriginInput {
    address?: string | null;
    lat?: number | null;
    lng?: number | null;
}

// ── 호출 캐시 ────────────────────────────────────────────────────────────────
// TMAP은 일일 호출 한도가 있는 외부 유료 API인데, 봇 대화는 같은 기관·같은 목적지를
// 반복해서 묻는다("내일도 시청", "다음 주도 시청"). 앱 쪽은 이미 localStorage에
// 같은 성격의 캐시를 두고 있다(src/lib/tmap/core.ts).
//
// **2단이다.** L1은 인스턴스 메모리, L2는 Firestore(`tmapCache`).
// L1만 두면 인스턴스가 재활용될 때마다 캐시가 통째로 날아간다 — 봇 트래픽은 띄엄띄엄해
// 콜드 스타트가 잦고, 그래서 적중률이 낮다. L2는 그 사이를 잇는다. Firestore 읽기 1회는
// TMAP 호출 1회보다 훨씬 싸고, 만료 정리는 이 저장소가 이미 쓰는 방식(firestore.indexes.json의
// `expiresAt` TTL 정책)에 그대로 얹으므로 정리용 스케줄 함수를 새로 만들 필요가 없다.
const GEO_CACHE_TTL_MS = 24 * 60 * 60 * 1000;   // 주소→좌표는 사실상 불변
const ROUTE_CACHE_TTL_MS = 3 * 60 * 60 * 1000;  // 소요시간은 교통량 따라 변하므로 짧게
const CACHE_MAX_ENTRIES = 200;                   // 인스턴스 메모리 상한(주소 문자열 기준 수십 KB)
const CACHE_COLLECTION = "tmapCache";

interface CacheEntry<T> {
    value: T;
    expiresAt: number;
}

const geoCache = new Map<string, CacheEntry<Coord | null>>();
const routeCache = new Map<string, CacheEntry<number | null>>();

/** 만료됐거나 없으면 undefined. 만료 항목은 읽는 김에 정리한다. */
function cacheGet<T>(cache: Map<string, CacheEntry<T>>, key: string, now: number): T | undefined {
    const hit = cache.get(key);
    if (!hit) return undefined;
    if (hit.expiresAt <= now) {
        cache.delete(key);
        return undefined;
    }
    return hit.value;
}

/** 상한을 넘으면 가장 오래 전에 넣은 항목부터 버린다(Map은 삽입 순서를 유지한다). */
function cacheSet<T>(cache: Map<string, CacheEntry<T>>, key: string, value: T, ttlMs: number, now: number): void {
    if (cache.size >= CACHE_MAX_ENTRIES) {
        const oldest = cache.keys().next();
        if (!oldest.done) cache.delete(oldest.value);
    }
    cache.set(key, { value, expiresAt: now + ttlMs });
}

/**
 * 문서 ID — 키를 해시한다. 주소에는 `/`가 들어갈 수 있어 그대로 쓰면 문서 경로가 깨지고,
 * 길이 상한(1500바이트)도 걸린다. 해시면 둘 다 신경 쓸 필요가 없다.
 */
function cacheDocId(kind: string, key: string): string {
    return createHash("sha1").update(`${kind}:${key}`).digest("hex");
}

/**
 * L2 조회. **캐시는 있으면 좋은 것이지 있어야 하는 것이 아니다** — Firestore가 느리거나
 * 실패해도 추정 자체는 TMAP 호출로 진행되어야 하므로 모든 오류를 삼키고 미스로 취급한다.
 *
 * TTL 정책의 삭제는 만료 후 최대 24시간까지 늦어질 수 있어 만료 판정을 여기서 다시 한다.
 */
async function l2Get<T>(kind: string, key: string, now: number): Promise<{ value: T } | undefined> {
    try {
        const snap = await getFirestore().collection(CACHE_COLLECTION).doc(cacheDocId(kind, key)).get();
        if (!snap.exists) return undefined;
        const data = snap.data() as { value?: T; expiresAt?: { toMillis?: () => number } | Date } | undefined;
        if (!data || data.value === undefined) return undefined;
        const expiresAt = data.expiresAt;
        const expiresMs = expiresAt instanceof Date
            ? expiresAt.getTime()
            : (typeof expiresAt?.toMillis === "function" ? expiresAt.toMillis() : 0);
        if (expiresMs <= now) return undefined;
        return { value: data.value };
    } catch {
        return undefined;
    }
}

/** L2 기록. 실패해도 무시한다 — 다음 호출이 다시 채우면 된다. */
async function l2Set<T>(kind: string, key: string, value: T, ttlMs: number, now: number): Promise<void> {
    try {
        await getFirestore().collection(CACHE_COLLECTION).doc(cacheDocId(kind, key)).set({
            value: value ?? null,
            // Date로 쓰면 Firestore가 timestamp로 저장한다 — TTL 정책이 요구하는 타입이다.
            expiresAt: new Date(now + ttlMs),
        });
    } catch {
        /* 캐시 기록 실패는 추정 결과에 영향을 주지 않는다 */
    }
}

/** 테스트 전용 — 케이스 간 L1 격리 (L2는 Firestore mock이 담당) */
export function __resetRouteEstimateCache(): void {
    geoCache.clear();
    routeCache.clear();
}

// ── 적중 추적 ────────────────────────────────────────────────────────────────
// 캐시를 넣었으면 그것이 값을 하는지도 볼 수 있어야 한다. 특히 L2는 "콜드 스타트 사이를
// 잇는다"는 가정 위에 있는데, 그 가정이 맞는지는 적중 출처를 남겨 두지 않으면 확인할 수 없다.
//
// 인스턴스 메모리 카운터로는 안 된다 — 인스턴스가 재활용되면 사라지고, 애초에 재활용 빈도가
// 알고 싶은 값이다. 그래서 **호출마다 구조화 로그 한 줄**을 남기고 집계는 Cloud Logging에
// 맡긴다. 로그는 이 정도 트래픽에서 사실상 무료이고, 인스턴스 수명과 무관하게 남는다.
//
// 집계 예: jsonPayload.function="routeEstimate" 로 필터한 뒤 route/destination 필드의
// l1·l2·api 분포를 보면 각 단의 적중률이 나온다. tmapCalls 평균이 실제 절감액이다.

/** 값이 어디서 왔는지. coord = 기관 좌표 재사용으로 조회 자체를 건너뜀 */
type LookupSource = "l1" | "l2" | "api" | "coord";

interface EstimateTrace {
    origin: LookupSource;
    destination: LookupSource;
    route: LookupSource;
    /** 실제로 나간 TMAP HTTP 호출 수 (지오코딩 폴백까지 포함한 실측) */
    tmapCalls: number;
}

function newTrace(): EstimateTrace {
    return { origin: "api", destination: "api", route: "api", tmapCalls: 0 };
}

/**
 * 추정 1회의 캐시 출처를 구조화 로그로 남긴다.
 *
 * 주소·목적지 문자열은 넣지 않는다 — 기관 주소와 방문지는 개인정보에 준해 다루는 값이고
 * (utils/mask의 전제와 같다), 적중률 집계에는 출처와 호출 수만 있으면 된다.
 */
function logEstimate(trace: EstimateTrace): void {
    log("INFO", "routeEstimate", "TMAP 추정 캐시 출처", {
        origin: trace.origin,
        destination: trace.destination,
        route: trace.route,
        tmapCalls: trace.tmapCalls,
    });
}

/** TMAP GET 요청 → JSON (실패 시 null) */
async function tmapGetJson(pathWithQuery: string, apiKey: string, trace: EstimateTrace): Promise<Record<string, unknown> | null> {
    trace.tmapCalls += 1;
    const res = await fetch(`${TMAP_BASE}${pathWithQuery}`, { headers: { appKey: apiKey } });
    if (!res.ok) return null;
    const text = await res.text();
    if (!text) return null;
    try {
        return JSON.parse(text) as Record<string, unknown>;
    } catch {
        return null;
    }
}

/** 주소·장소명 → 좌표 (POI 검색 우선, 실패 시 fullAddrGeo). 앱 geocode() 동형 */
async function geocode(
    query: string,
    apiKey: string,
    trace: EstimateTrace,
    slot: "origin" | "destination",
): Promise<Coord | null> {
    const trimmed = query.trim();
    if (trimmed.length < 2) return null;

    // 실패(null)도 캐시한다 — 오타·미등록 주소를 매번 두 번씩(POI+주소) 다시 물어보지 않기 위해서다.
    const now = Date.now();
    const hit = cacheGet(geoCache, trimmed, now);
    if (hit !== undefined) {
        trace[slot] = "l1";
        return hit;
    }

    const stored = await l2Get<Coord | null>("geo", trimmed, now);
    if (stored) {
        // L2에서 올라온 값은 L1에도 채워, 같은 인스턴스의 다음 호출은 Firestore도 안 간다.
        cacheSet(geoCache, trimmed, stored.value, GEO_CACHE_TTL_MS, now);
        trace[slot] = "l2";
        return stored.value;
    }

    trace[slot] = "api";
    const result = await geocodeUncached(trimmed, apiKey, trace);
    cacheSet(geoCache, trimmed, result, GEO_CACHE_TTL_MS, now);
    await l2Set("geo", trimmed, result, GEO_CACHE_TTL_MS, now);
    return result;
}

async function geocodeUncached(trimmed: string, apiKey: string, trace: EstimateTrace): Promise<Coord | null> {
    // 괄호 내 실제 주소 추출: "서울역 (서울 용산구 …)" → "서울 용산구 …"
    const m = trimmed.match(/\(([^)]+)\)/);
    const clean = m ? m[1].trim() : trimmed;

    // 1) POI 검색
    const poiData = await tmapGetJson(
        `/tmap/pois?version=1&format=json&searchKeyword=${encodeURIComponent(clean)}&resCoordType=WGS84GEO&reqCoordType=WGS84GEO&count=1`,
        apiKey,
        trace,
    );
    const poi = (poiData as { searchPoiInfo?: { pois?: { poi?: Array<Record<string, string>> } } })
        ?.searchPoiInfo?.pois?.poi?.[0];
    if (poi?.noorLat && poi?.noorLon) {
        const lat = parseFloat(poi.noorLat);
        const lon = parseFloat(poi.noorLon);
        if (lat && lon) return { lat, lon };
    }

    // 2) 지오코딩(fullAddrGeo) 폴백
    const geoData = await tmapGetJson(
        `/tmap/geo/fullAddrGeo?version=1&format=json&coordType=WGS84GEO&fullAddr=${encodeURIComponent(clean)}`,
        apiKey,
        trace,
    );
    const item = (geoData as { coordinateInfo?: { coordinate?: Array<Record<string, string>> } })
        ?.coordinateInfo?.coordinate?.[0];
    if (item) {
        const lat = parseFloat(item.newLat || item.lat);
        const lon = parseFloat(item.newLon || item.lon);
        if (lat && lon) return { lat, lon };
    }
    return null;
}

/** 좌표 간 자동차 경로의 소요시간(분). 실패 시 null */
async function routeDurationMin(start: Coord, end: Coord, apiKey: string, trace: EstimateTrace): Promise<number | null> {
    // 앱(routing.ts)과 같이 좌표를 소수점 5자리로 끊어 키를 만든다 — 미터 단위 흔들림으로
    // 캐시가 빗나가지 않게 하기 위해서다.
    const key = `${start.lon.toFixed(5)},${start.lat.toFixed(5)}-${end.lon.toFixed(5)},${end.lat.toFixed(5)}`;
    const now = Date.now();
    const hit = cacheGet(routeCache, key, now);
    if (hit !== undefined) {
        trace.route = "l1";
        return hit;
    }

    const stored = await l2Get<number | null>("route", key, now);
    if (stored) {
        cacheSet(routeCache, key, stored.value, ROUTE_CACHE_TTL_MS, now);
        trace.route = "l2";
        return stored.value;
    }

    trace.route = "api";
    const result = await routeDurationMinUncached(start, end, apiKey, trace);
    cacheSet(routeCache, key, result, ROUTE_CACHE_TTL_MS, now);
    await l2Set("route", key, result, ROUTE_CACHE_TTL_MS, now);
    return result;
}

async function routeDurationMinUncached(start: Coord, end: Coord, apiKey: string, trace: EstimateTrace): Promise<number | null> {
    trace.tmapCalls += 1;
    const res = await fetch(`${TMAP_BASE}/tmap/routes?version=1&format=json`, {
        method: "POST",
        headers: { "Content-Type": "application/json", appKey: apiKey },
        body: JSON.stringify({
            startX: start.lon.toString(),
            startY: start.lat.toString(),
            endX: end.lon.toString(),
            endY: end.lat.toString(),
            reqCoordType: "WGS84GEO",
            resCoordType: "WGS84GEO",
            searchOption: "0",
            carType: "0",
        }),
    });
    if (!res.ok) return null;
    const text = await res.text();
    if (!text) return null;
    let data: { features?: Array<{ properties?: { totalTime?: number } }> };
    try {
        data = JSON.parse(text);
    } catch {
        return null;
    }
    const totalTime = data?.features?.[0]?.properties?.totalTime;
    if (typeof totalTime !== "number" || totalTime <= 0) return null;
    return Math.round(totalTime / 60);
}

/**
 * 기관(출발지) → 목적지 편도 소요시간(분)을 추정한다. 실패 시 null(호출부가 종료 시간 되묻기).
 *
 * 출발지는 주소 문자열이나 `{ address, lat, lng }` 어느 쪽으로도 줄 수 있다.
 * **좌표가 있으면 지오코딩을 건너뛴다** — 기관 문서에는 이미 lat/lng가 저장돼 있고
 * (backfillOrgCoords가 채운다), 그 좌표를 매 대화마다 주소로 다시 조회하는 것은
 * 결과가 정해진 호출을 낭비하는 것이다. 좌표가 없는 기관만 주소로 폴백한다.
 */
export async function estimateOneWayDurationMin(
    origin: string | OriginInput | undefined | null,
    destination: string,
): Promise<number | null> {
    const apiKey = TMAP_API_KEY.value();
    if (!apiKey || !destination?.trim()) return null;

    const originInput: OriginInput = typeof origin === "string" ? { address: origin } : (origin ?? {});
    const hasCoord = typeof originInput.lat === "number" && typeof originInput.lng === "number"
        && Number.isFinite(originInput.lat) && Number.isFinite(originInput.lng);
    if (!hasCoord && !originInput.address?.trim()) return null;

    const trace = newTrace();
    try {
        let start: Coord | null;
        if (hasCoord) {
            start = { lat: originInput.lat as number, lon: originInput.lng as number };
            trace.origin = "coord";
        } else {
            start = await geocode(originInput.address as string, apiKey, trace, "origin");
        }
        if (!start) return null;
        const dest = await geocode(destination, apiKey, trace, "destination");
        if (!dest) return null;
        return await routeDurationMin(start, dest, apiKey, trace);
    } catch {
        return null;
    } finally {
        // 성공·실패·예외 어느 쪽으로 끝나도 남긴다. 실패한 호출만 캐시를 못 타는 패턴이
        // 있을 수 있어, 실패분을 빼고 집계하면 적중률이 실제보다 좋아 보인다.
        logEstimate(trace);
    }
}

/**
 * 시작시간 + 편도 소요시간으로 종료시간을 계산한다(앱 calcEndTime 동형).
 * 왕복(×2) + 여유 1시간, 10분 단위 올림, 23:59 상한.
 */
export function calcEndTimeFromDuration(startTime: string, durationMin: number): string {
    const [h, m] = startTime.split(":").map(Number);
    const addMin = durationMin * 2 + 60;
    const rounded = Math.ceil(addMin / 10) * 10;
    const total = Math.min(h * 60 + m + rounded, 23 * 60 + 59);
    return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}
