/**
 * backfillOrgCoords — 기존 기관 좌표 마이그레이션 (Callable Cloud Function)
 * address가 있지만 lat/lng가 없는 기관에 대해 Tmap으로 좌표를 조회하여 저장
 */
import { onCall } from "firebase-functions/https";
import { defineString } from "firebase-functions/params";
import { getFirestore } from "firebase-admin/firestore";
import { requireSuperAdmin } from "../../utils/helpers";

const tmapApiKey = defineString("TMAP_API_KEY");

async function geocodeByTmapBackfill(address: string, apiKey: string): Promise<{ lat: number; lng: number } | null> {
    if (!address?.trim() || !apiKey) return null;

    try {
        const poiUrl = `https://apis.openapi.sk.com/tmap/pois?version=1&format=json&searchKeyword=${encodeURIComponent(address)}&resCoordType=WGS84GEO&reqCoordType=WGS84GEO&count=1`;
        const poiRes = await fetch(poiUrl, { headers: { appKey: apiKey } });
        const poiData = await poiRes.json() as { searchPoiInfo?: { pois?: { poi?: Array<{ noorLat: string; noorLon: string }> } } };
        const poi = poiData?.searchPoiInfo?.pois?.poi?.[0];
        if (poi) {
            const lat = parseFloat(poi.noorLat);
            const lng = parseFloat(poi.noorLon);
            if (lat && lng) return { lat, lng };
        }

        const geoUrl = `https://apis.openapi.sk.com/tmap/geo/fullAddrGeo?version=1&format=json&coordType=WGS84GEO&fullAddr=${encodeURIComponent(address)}`;
        const geoRes = await fetch(geoUrl, { headers: { appKey: apiKey } });
        const geoData = await geoRes.json() as { coordinateInfo?: { coordinate?: Array<{ newLat: string; lat: string; newLon: string; lon: string }> } };
        const item = geoData?.coordinateInfo?.coordinate?.[0];
        if (item) {
            const lat = parseFloat(item.newLat || item.lat);
            const lng = parseFloat(item.newLon || item.lon);
            if (lat && lng) return { lat, lng };
        }
    } catch (err: unknown) {
        console.warn("[Backfill] Tmap geocoding 실패:", (err as Error).message);
    }
    return null;
}

export const backfillOrgCoords = onCall(
    {
        region: "asia-northeast3",
        timeoutSeconds: 540,
        memory: "256MiB",
        enforceAppCheck: true,
    },
    async (request) => {
        // superAdmin만 전체 기관 좌표 일괄 수정 가능
        requireSuperAdmin(request);

        const db = getFirestore();
        const apiKey = tmapApiKey.value();

        const orgSnap = await db.collection("organizations")
            .where("status", "==", "approved")
            .get();

        let updated = 0;
        let skipped = 0;
        let failed = 0;

        for (const doc of orgSnap.docs) {
            const data = doc.data();
            const address = data.address || data.aiVerifyDetail?.address || "";

            if (data.lat && data.lng) {
                skipped++;
                continue;
            }
            if (!address) {
                skipped++;
                continue;
            }

            const coords = await geocodeByTmapBackfill(address, apiKey);
            if (coords) {
                await doc.ref.update({
                    lat: coords.lat,
                    lng: coords.lng,
                    ...(!data.address && data.aiVerifyDetail?.address ? { address: data.aiVerifyDetail.address } : {}),
                });
                updated++;
                console.log(`[Backfill] ${data.name}: ${address} -> (${coords.lat}, ${coords.lng})`);
            } else {
                failed++;
                console.warn(`[Backfill] ${data.name}: 좌표 변환 실패 (${address})`);
            }

            await new Promise(r => setTimeout(r, 100));
        }

        const result = { total: orgSnap.size, updated, skipped, failed };
        console.log("[Backfill] 완료:", result);
        return result;
    }
);
