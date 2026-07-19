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

const TMAP_API_KEY = defineString("TMAP_API_KEY");
const TMAP_BASE = "https://apis.openapi.sk.com";

interface Coord {
    lon: number;
    lat: number;
}

/** TMAP GET 요청 → JSON (실패 시 null) */
async function tmapGetJson(pathWithQuery: string, apiKey: string): Promise<Record<string, unknown> | null> {
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
async function geocode(query: string, apiKey: string): Promise<Coord | null> {
    const trimmed = query.trim();
    if (trimmed.length < 2) return null;
    // 괄호 내 실제 주소 추출: "서울역 (서울 용산구 …)" → "서울 용산구 …"
    const m = trimmed.match(/\(([^)]+)\)/);
    const clean = m ? m[1].trim() : trimmed;

    // 1) POI 검색
    const poiData = await tmapGetJson(
        `/tmap/pois?version=1&format=json&searchKeyword=${encodeURIComponent(clean)}&resCoordType=WGS84GEO&reqCoordType=WGS84GEO&count=1`,
        apiKey,
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
async function routeDurationMin(start: Coord, end: Coord, apiKey: string): Promise<number | null> {
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
 * 기관 주소 → 목적지 편도 소요시간(분)을 추정한다. 실패 시 null(호출부가 종료 시간 되묻기).
 */
export async function estimateOneWayDurationMin(
    originAddress: string | undefined | null,
    destination: string,
): Promise<number | null> {
    const apiKey = TMAP_API_KEY.value();
    if (!apiKey || !originAddress?.trim() || !destination?.trim()) return null;
    try {
        const origin = await geocode(originAddress, apiKey);
        if (!origin) return null;
        const dest = await geocode(destination, apiKey);
        if (!dest) return null;
        return await routeDurationMin(origin, dest, apiKey);
    } catch {
        return null;
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
