// tmap 폴더의 모든 모듈을 하나로 재수출하는 Barrel 파일
export {
    VEHICLE_TYPE_TO_CAR_TYPE,
    isTmapCoolingDown,
    isTmapAvailable,
    MAX_DESTINATIONS,
    parseDestinations,
} from './core';

export { searchPOI, searchPOIList, geocode } from './geocoding';
export type { PoiResult } from './geocoding';

export {
    getRoute,
    getRouteByAddress,
    getMultiRoute,
    getRouteInfo,
    getMultiRouteWithFreeRoad,
    getFreeRoadRoute,
} from './routing';

export { getNavigationDeeplink } from './deeplink';
