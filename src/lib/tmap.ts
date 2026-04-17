/**
 * tmap.ts — Proxy Re-export
 * 이 파일은 src/lib/tmap/ 폴더로 분해된 모듈들을 기존 인터페이스를 유지한 채 재수출합니다.
 * 기존 코드의 import 경로 변경 없이 리팩토링 효과를 얻을 수 있습니다.
 * 실제 로직은 src/lib/tmap/ 내부의 개별 모듈을 수정하세요.
 */
export {
    VEHICLE_TYPE_TO_CAR_TYPE,
    isTmapCoolingDown,
    isTmapAvailable,
    MAX_DESTINATIONS,
    parseDestinations,
} from './tmap/core';

export { searchPOI, geocode } from './tmap/geocoding';

export {
    getRoute,
    getRouteByAddress,
    getMultiRoute,
    getRouteInfo,
    getMultiRouteWithFreeRoad,
} from './tmap/routing';

export { getNavigationDeeplink } from './tmap/deeplink';
