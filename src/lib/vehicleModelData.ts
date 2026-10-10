/**
 * vehicleModelData — 차량 모델명 자동완성/분류용 정적 데이터
 *
 * useVehicleManager.ts에서 분리된 순수 데이터 모듈.
 */

import type { FuelType } from '../types/vehicle';

// ─────────────────────────────────────────────────────────────
// 자동완성용 한국 차량 모델명 정적 목록
// (scripts/normalizeVehicleModelNames.ts 의 STANDARD_MODELS 와 동기화)
// ─────────────────────────────────────────────────────────────
export const VEHICLE_MODEL_SUGGESTIONS = [
    // 현대 — 승용/SUV
    '아반떼', '소나타', '그랜저', '아이오닉', '아이오닉5', '아이오닉6', '아이오닉9', '코나', '투싼', '싼타페', '팰리세이드',
    '엑센트', '클릭', '베뉴', '캐스퍼', '캐스퍼 일렉트릭',
    // 현대 — 상용/승합/버스
    '스타리아', '스타리아 일렉트릭', '스타렉스', '그랜드 스타렉스', '포터', '마이티', '카운티', '솔라티', '에어로타운', '유니버스',
    // 기아 — 승용/SUV
    'K3', 'K5', 'K8', 'K9', '레이', '모닝', '스포티지', '쏘렌토', '카니발', '그랜드 카니발', '텔루라이드',
    '셀토스', '니로', '쏘울', '프라이드', '로체',
    // 기아 — 전기
    'EV3', 'EV4', 'EV5', 'EV6', 'EV9', 'PV5', '레이 EV',
    // 기아 — 상용
    '봉고', '타스만',
    // 제네시스
    'G70', 'G80', 'G90', 'GV60', 'GV70', 'GV80',
    // KG모빌리티(구 쌍용)
    '티볼리', '코란도', '렉스턴', '무쏘', '무쏘 EV', '토레스', '토레스 EVX', '액티언',
    // 르노코리아
    'SM6', 'SM7', 'QM6', '클리오', 'XM3', '아르카나', '그랑 콜레오스', '세닉',
    // 쉐보레/GM대우
    '스파크', '말리부', '트랙스', '트레일블레이저', '이쿼녹스', '마티즈', '볼트EV',
    // 도요타
    '캠리',
    // 수입 전기차
    '테슬라 모델 3', '테슬라 모델 Y', 'BYD 아토3', 'BYD 씰',
    // 버스
    'BH090', 'CEVO-C',
    // 수소·전기 전용
    '넥쏘',
];

// 전기차 모델명 목록
// 'EV'·'일렉트릭'은 '레이 EV'·'캐스퍼 일렉트릭'처럼 모델명 뒤에 붙는 표기를 잡는다.
// 영문·숫자 표기는 앞뒤가 다른 영문·숫자와 붙어 있으면 일치로 보지 않는다(containsModel).
const ELECTRIC_MODELS = [
    'EV', 'EVX', '일렉트릭', 'Electric',
    '아이오닉', '아이오닉5', '아이오닉6', '아이오닉7',
    'EV3', 'EV4', 'EV5', 'EV6', 'EV9', '니로EV', '니로 EV', '코나EV', '코나 EV', '코나 일렉트릭',
    '볼트EV', '볼트 EV', '볼트EUV', '쉐보레 볼트',
    'GV60',
    '테슬라', 'Model 3', 'Model Y', 'Model S', 'Model X',
    'e-트론', 'ID.4', '폴스타', '제로', 'i4', 'iX', 'iX1', 'iX3',
    'BYD', '아토3', '씨라이언',
    'SM3 Z.E', 'ZOE', '트위지',
    '포터EV', '포터 EV', '봉고EV', '봉고 EV',
    'PV5',
];

// 전기차 키워드와 겹쳐도 전기차가 아닌 표기
// - 하이브리드: '아이오닉 하이브리드'는 주유하는 차다
// - 투싼: 현대 '투싼 ix'의 'ix'가 BMW 전기차 'iX'와 겹친다(투싼은 전기차 모델이 없다)
const NOT_ELECTRIC_MARKERS = ['하이브리드', 'HEV', 'PHEV', '투싼'];

// 수소차 모델명 목록
const HYDROGEN_MODELS = ['넥쏘', 'nexo'];

// 모델명 → 차종 자동 매핑
// 차종 enum에 SUV가 없어 SUV는 승용(sedan)으로, 픽업트럭은 법적 분류대로 화물(truck)로 둔다.
// 여러 차종에 걸리면 가장 길게 일치한 모델명을 따른다(예: '트레일블레이저'가 경차 '레이'보다 우선).
const MODEL_TYPE_MAP: Record<string, string[]> = {
    compact: ['모닝', '캐스퍼', '마티즈', '레이', '스파크', '다마스', '티코', '트위즈', '피카퇴', 'ZOE', '트위지'],
    sedan: [
        '소나타', '아반떼', '그랜저', 'K5', 'K3', 'K7', 'K8', 'K9', '말리부', '셀토스', '제네시스', 'SM6', 'SM7', 'SM3', '클리오', '투슨', 'i30', 'i40',
        '엑센트', '클릭', '베뉴', '쏘울', '프라이드', '로체', '캠리',
        '아이오닉', 'EV3', 'EV4', 'EV5', 'EV6', 'EV9', '니로', '코나', '볼트', 'PV5',
        '테슬라', 'Model 3', 'Model Y', 'Model S', 'Model X',
        'e-트론', 'ID.4', '폴스타', '제로', 'i4', 'iX',
        '넥쏘', 'nexo',
        // SUV
        '투싼', 'ix35', '싼타페', '팰리세이드', '스포티지', '쏘렌토', '텔루라이드',
        'G70', 'G80', 'G90', 'GV60', 'GV70', 'GV80',
        '티볼리', '코란도', '렉스턴', '토레스', '액티언',
        'QM6', 'XM3', '아르카나', '콜레오스', '세닉',
        '트랙스', '트레일블레이저', '이쿼녹스',
        'BYD', '아토3', '씨라이언',
    ],
    van: ['스타렉스', '스타랙스', '그랜드 스타렉스', '스타리아', '스타리야', '카니발', '카니벌', '솔라티', '솔라디', '그레이스'],
    bus: ['유니버스', '에어로타운', '에어로', '카운티', '카운디', '레스타', 'BH090', 'CEVO-C', '시티', '그린시티'],
    truck: [
        '포터', '봉고', '봉구', '마이티', '메가트럭', '노부스', '파비스', '더카고', '그랜버드',
        // 픽업트럭
        '타스만', '무쏘', '렉스턴 스포츠', '코란도 스포츠',
    ],
};

// ── 판별 함수 ──

const isAsciiAlnum = (ch: string | undefined) => ch !== undefined && /[a-z0-9]/.test(ch);

/**
 * 소문자 모델명 안에 소문자 키워드가 들어 있는지.
 * 영문·숫자로 시작·끝나는 키워드는 바로 옆 글자가 영문·숫자면 다른 모델명의 일부로 보고 건너뛴다
 * (예: 'i40' 속 'i4', 'ix35' 속 'ix'는 일치 아님).
 */
const containsModel = (name: string, keyword: string) => {
    const checkStart = isAsciiAlnum(keyword[0]);
    const checkEnd = isAsciiAlnum(keyword[keyword.length - 1]);
    for (let i = name.indexOf(keyword); i !== -1; i = name.indexOf(keyword, i + 1)) {
        if (checkStart && isAsciiAlnum(name[i - 1])) continue;
        if (checkEnd && isAsciiAlnum(name[i + keyword.length])) continue;
        return true;
    }
    return false;
};

const containsAny = (name: string, keywords: string[]) =>
    keywords.some(m => containsModel(name, m.toLowerCase()));

/** 모델명이 전기차인지 판별 */
export const isElectricModel = (modelName: string) => {
    const name = modelName.trim().toLowerCase();
    if (!name) return false;
    if (containsAny(name, NOT_ELECTRIC_MARKERS)) return false;
    return containsAny(name, ELECTRIC_MODELS);
};

/** 모델명이 수소차인지 판별 */
export const isHydrogenModel = (modelName: string) => {
    const name = modelName.trim().toLowerCase();
    if (!name) return false;
    return containsAny(name, HYDROGEN_MODELS);
};

/** 연료 타입이 충전 가능한지 판별 */
export const isChargeableFuel = (fuel?: string | null) => fuel === 'electric' || fuel === 'hydrogen';

/** 모델명 → 차종 추측 (가장 길게 일치한 모델명의 차종, 같은 길이면 목록 앞쪽 차종) */
export const guessVehicleType = (modelName: string): string | null => {
    const name = modelName.trim().toLowerCase();
    if (!name) return null;
    let best: { type: string; length: number } | null = null;
    for (const [type, models] of Object.entries(MODEL_TYPE_MAP)) {
        for (const m of models) {
            const keyword = m.toLowerCase();
            if ((!best || keyword.length > best.length) && containsModel(name, keyword)) {
                best = { type, length: keyword.length };
            }
        }
    }
    return best?.type ?? null;
};

/** 차종별 기본 연료 유형 */
export const DEFAULT_FUEL: Record<string, FuelType> = {
    compact: 'gasoline', sedan: 'gasoline', van: 'diesel', bus: 'diesel', truck: 'diesel',
};
