/**
 * 프로젝트 전역 상수
 * 차량 관련 아이콘, 색상, 유틸 등 여러 컴포넌트에서 공유하는 값을 한 곳에서 관리한다.
 */

// 차종별 이모지 아이콘
export const VEHICLE_TYPE_ICONS: Record<string, string> = {
    compact: '🚙',
    sedan: '🚗',
    van: '🚐',
    truck: '🚚',
    bus: '🚌',
};

// 차량별 고정 배경 색상 (ID 해시 기반)
export const VEHICLE_COLORS = [
    'bg-red-200', 'bg-blue-200', 'bg-yellow-200', 'bg-green-200', 'bg-purple-200',
    'bg-orange-300', 'bg-cyan-200', 'bg-pink-300', 'bg-indigo-300', 'bg-lime-300',
];

// 차량 ID를 해시하여 고유 색상을 배정
export const getVehicleColor = (id: string) => {
    let hash = 0;
    for (let i = 0; i < id.length; i++) hash = ((hash << 5) - hash) + id.charCodeAt(i);
    return VEHICLE_COLORS[Math.abs(hash) % VEHICLE_COLORS.length];
};

// 앱 공개 URL
export const APP_URL = 'https://vehicle-drive-log.web.app';

/**
 * 이용약관·개인정보 처리방침의 시행일 버전 (동의 기록용)
 *
 * TermsPage/PrivacyPage 본문을 개정하면 해당 문서의 시행일로 이 값을 함께 갱신한다.
 * 기관 신청 시 동의한 버전이 organizations 문서에 저장되므로,
 * 값을 갱신하지 않으면 개정 후 동의가 이전 버전으로 기록된다.
 */
export const TERMS_VERSION = '2026-08-05';
export const PRIVACY_VERSION = '2026-08-05';
