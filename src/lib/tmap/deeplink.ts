import { geocode } from './geocoding';
import { parseDestinations } from './core';

/** TMap 경로 안내 딥링크 생성 */
const getTmapDeeplink = async (destination: string) => {
    if (!destination) return 'tmap://open';

    const dests = parseDestinations(destination);
    if (dests.length === 0) return 'tmap://open';

    const goalName = dests[0];
    try {
        const goalCoord = await geocode(goalName);
        let url = 'tmap://route?';
        if (goalCoord) {
            url += `goalname=${encodeURIComponent(goalName)}&goalx=${goalCoord.lon}&goaly=${goalCoord.lat}`;
        } else {
            url += `goalname=${encodeURIComponent(goalName)}`;
        }
        return url;
    } catch (e) {
        console.warn('TMap 딥링크 생성 실패:', e);
    }
    return `tmap://route?goalname=${encodeURIComponent(goalName)}`;
};

/** 네이버 지도 경로 안내 딥링크 생성 */
const getNaverMapDeeplink = async (destination: string) => {
    if (!destination) return 'nmap://actionPath?appname=vehicle-log';

    const dests = parseDestinations(destination);
    if (dests.length === 0) return 'nmap://actionPath?appname=vehicle-log';

    try {
        const coords = await Promise.all(dests.map(d => geocode(d)));
        const goalIdx = dests.length - 1;
        const goalCoord = coords[goalIdx];

        if (!goalCoord) return 'nmap://actionPath?appname=vehicle-log';

        let url = `nmap://navigation?dlat=${goalCoord.lat}&dlng=${goalCoord.lon}&dname=${encodeURIComponent(dests[goalIdx])}&appname=vehicle-log`;

        for (let i = 0; i < Math.min(goalIdx, 5); i++) {
            if (coords[i]) {
                url += `&v${i + 1}lat=${coords[i]!.lat}&v${i + 1}lng=${coords[i]!.lon}&v${i + 1}name=${encodeURIComponent(dests[i])}`;
            }
        }
        return url;
    } catch (e) {
        console.warn('네이버 지도 딥링크 생성 실패:', e);
    }
    return 'nmap://actionPath?appname=vehicle-log';
};

/** 카카오맵 경로 안내 딥링크 생성 */
const getKakaoMapDeeplink = async (destination: string) => {
    if (!destination) return 'kakaomap://open';

    const dests = parseDestinations(destination);
    if (dests.length === 0) return 'kakaomap://open';

    try {
        const coords = [];
        for (const d of dests) {
            coords.push(await geocode(d));
        }
        const goalIdx = dests.length - 1;
        const goalCoord = coords[goalIdx];

        if (!goalCoord) return 'kakaomap://open';

        let url = `kakaomap://route?ep=${goalCoord.lat},${goalCoord.lon}&by=CAR`;

        for (let i = 0; i < goalIdx; i++) {
            if (coords[i]) {
                url += `&wp${i + 1}=${coords[i]!.lat},${coords[i]!.lon}`;
            }
        }
        return url;
    } catch (e) {
        console.warn('카카오맵 딥링크 생성 실패:', e);
    }
    return 'kakaomap://open';
};

/** 통합 내비게이션 딥링크 생성 */
export const getNavigationDeeplink = async (app: string, destination: string) => {
    switch (app) {
        case 'naver': return getNaverMapDeeplink(destination);
        case 'kakao': return getKakaoMapDeeplink(destination);
        case 'tmap':
        default: return getTmapDeeplink(destination);
    }
};
