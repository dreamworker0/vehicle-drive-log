/**
 * vehicleModelData — 차량 모델명 자동완성/분류용 정적 데이터
 *
 * useVehicleManager.ts에서 분리된 순수 데이터 모듈.
 */

import type { FuelType } from '../types/vehicle';

// ─────────────────────────────────────────────────────────────
// 자동완성용 한국 차량 모델명 정적 목록
// ─────────────────────────────────────────────────────────────
export const VEHICLE_MODEL_SUGGESTIONS = [
    // 현대 — 승용/SUV
    '아반떼', '소나타', '그랜저', '아이오닉', '아이오닉5', '아이오닉6', '코나', '투싼', '싼타페', '팰리세이드',
    '엑센트', '클릭', '베뉴', '캐스퍼',
    // 현대 — 상용/승합/버스
    '스타리아', '스타렉스', '그랜드 스타렉스', '포터', '마이티', '카운티', '솔라티', '에어로타운', '유니버스',
    // 기아 — 승용/SUV
    'K3', 'K5', 'K8', 'K9', '레이', '모닝', '스포티지', '쏘렌토', '카니발', '그랜드 카니발', '텔루라이드',
    '셀토스', '니로', '쏘울', '프라이드', '로체',
    // 기아 — 전기
    'EV3', 'EV5', 'EV6', 'EV9', 'PV5',
    // 기아 — 상용
    '봉고',
    // 제네시스
    'G70', 'G80', 'G90', 'GV70', 'GV80',
    // KG모빌리티(구 쌍용)
    '티볼리', '코란도', '렉스턴', '무쏘', '토레스',
    // 르노코리아
    'SM6', 'SM7', 'QM6', '클리오', 'XM3',
    // 쉐보레/GM대우
    '스파크', '말리부', '트랙스', '트레일블레이저', '이쿼녹스', '마티즈', '볼트EV',
    // 도요타
    '캠리',
    // 버스
    'BH090', 'CEVO-C',
    // 수소·전기 전용
    '넥쏘',
];

// 전기차 모델명 목록
const ELECTRIC_MODELS = [
    '아이오닉', '아이오닉5', '아이오닉6', '아이오닉7',
    'EV3', 'EV5', 'EV6', 'EV9', '니로EV', '니로 EV', '코나EV', '코나 EV', '코나 일렉트릭',
    '볼트EV', '볼트 EV', '볼트EUV', '쉐보레 볼트',
    '테슬라', 'Model 3', 'Model Y', 'Model S', 'Model X',
    'e-트론', 'ID.4', '폴스타', '제로', 'i4', 'iX',
    'SM3 Z.E', 'ZOE', '트위지',
    '포터EV', '포터 EV', '봉고EV', '봉고 EV',
    'PV5',
];

// 수소차 모델명 목록
const HYDROGEN_MODELS = ['넥쏘', 'nexo'];

// 모델명 → 차종 자동 매핑
const MODEL_TYPE_MAP: Record<string, string[]> = {
    compact: ['모닝', '캐스퍼', '마티즈', '레이', '스파크', '다마스', '티코', '트위즈', '피카퇴', 'ZOE', '트위지'],
    sedan: [
        '소나타', '아반떼', '그랜저', 'K5', 'K3', 'K7', 'K8', 'K9', '말리부', '셀토스', '제네시스', 'SM6', 'SM3', '투슨', 'i30', 'i40',
        '엑센트', '클릭', '베뉴', '쏘울', '프라이드', '로체', '캠리',
        '아이오닉', 'EV3', 'EV5', 'EV6', 'EV9', '니로', '코나', '볼트', 'PV5',
        '테슬라', 'Model 3', 'Model Y', 'Model S', 'Model X',
        'e-트론', 'ID.4', '폴스타', '제로', 'i4', 'iX',
        '넥쏘', 'nexo'
    ],
    van: ['스타렉스', '스타랙스', '그랜드 스타렉스', '스타리아', '스타리야', '카니발', '카니벌', '솔라티', '솔라디'],
    bus: ['유니버스', '에어로타운', '에어로', '카운티', '카운디', '레스타', 'BH090', 'CEVO-C', '시티', '그린시티'],
    truck: ['포터', '봉고', '봉구', '마이티', '메가트럭', '노부스', '파비스', '더카고', '그랜버드'],
};

// ── 판별 함수 ──

/** 모델명이 전기차인지 판별 */
export const isElectricModel = (modelName: string) => {
    const name = modelName.trim().toLowerCase();
    if (!name) return false;
    return ELECTRIC_MODELS.some(m => name.includes(m.toLowerCase()));
};

/** 모델명이 수소차인지 판별 */
export const isHydrogenModel = (modelName: string) => {
    const name = modelName.trim().toLowerCase();
    if (!name) return false;
    return HYDROGEN_MODELS.some(m => name.includes(m.toLowerCase()));
};

/** 연료 타입이 충전 가능한지 판별 */
export const isChargeableFuel = (fuel?: string | null) => fuel === 'electric' || fuel === 'hydrogen';

/** 모델명 → 차종 추측 */
export const guessVehicleType = (modelName: string): string | null => {
    const name = modelName.trim().toLowerCase();
    if (!name) return null;
    for (const [type, models] of Object.entries(MODEL_TYPE_MAP)) {
        if (models.some(m => name.includes(m.toLowerCase()))) return type;
    }
    return null;
};

/** 차종별 기본 연료 유형 */
export const DEFAULT_FUEL: Record<string, FuelType> = {
    compact: 'gasoline', sedan: 'gasoline', van: 'diesel', bus: 'diesel', truck: 'diesel',
};
