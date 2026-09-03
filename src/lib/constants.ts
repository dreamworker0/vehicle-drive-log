/**
 * 프로젝트 전역 상수
 * 차량 관련 아이콘, 색상, 유틸 등 여러 컴포넌트에서 공유하는 값을 한 곳에서 관리한다.
 */
import { deleteField } from 'firebase/firestore';

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
 *
 * ## 두 값은 항상 함께 움직인다
 * 약관 제9조(개인정보 처리의 위탁)와 처리방침 제7·8조(위탁·국외 이전)는 짝이다.
 * 한쪽만 올리면 "약관은 위탁을 규정하는데 처리방침 구버전에는 수탁자 고지가 없는"
 * 구간이 시행일 차이만큼 생긴다. 본문이 한쪽만 바뀌어도 시행일은 같이 옮긴다.
 *
 * ## 개정 이력
 * - `2026-08-05` (최초 지정): 위탁·국외 이전·보호책임자 조항 신설, 수탁자 지위 명시
 * - `2026-08-10`: 접속기록(계정·일시·접속지 IP·접속 환경) 수집 항목을 처리방침에
 *   명시하면서 시행 전 재지정. 8/1~8/4에 동의한 기관은 이 항목이 없는 문안에
 *   동의한 것이 되므로, 시행일을 옮겨 재동의를 받는다(ConsentGate가 자동 판정).
 *   오늘(8/1) 기준 9일 유예 — 처리방침 변경은 최소 7일 전 공지가 관행이다.
 */
export const TERMS_VERSION = '2026-08-10';
export const PRIVACY_VERSION = '2026-08-10';

/**
 * 시행일 버전('2026-08-10')을 문서 표기('2026년 8월 10일')로 변환한다.
 *
 * 약관·처리방침 페이지의 시행일 표기를 이 함수로 파생시켜, 본문 표기와 동의 기록에
 * 남는 버전이 어긋나는 것을 구조적으로 막는다. 표기를 문자열로 하드코딩하면
 * 개정 때 한쪽만 고쳐도 아무것도 실패하지 않는다.
 */
export const formatLegalVersion = (version: string) => {
    const [year, month, day] = version.split('-');
    return `${year}년 ${Number(month)}월 ${Number(day)}일`;
};

/**
 * 캘린더 동기화 실패 임계 — 서버 `calendarFailTracking.MAX_FAIL_COUNT`와 같은 값이다.
 * 이 이상이면 스케줄러도 예약 트리거도 그 차량 호출을 아예 건너뛰므로, 설정을 고쳐도
 * 저절로 돌아오지 않는다(관리자가 '연동 테스트'를 눌러야 복구된다).
 *
 * 화면마다 10을 적어 두면 서버 상수를 바꿨을 때 화면이 조용히 거짓말을 한다 —
 * 자동 재시도가 살아 있는데 "중단됨"이라 하거나 그 반대가 된다.
 */
export const CALENDAR_MAX_FAIL_COUNT = 10;

/** 관리자 화면에 '동기화 실패' 배지를 띄우는 임계 (서버의 쿨다운 진입 지점과 같다) */
export const CALENDAR_FAIL_BADGE_THRESHOLD = 3;

/**
 * 캘린더 실패 상태를 되돌릴 때 함께 지워야 하는 필드 집합.
 *
 * 서버 `resetCalendarFailure`와 짝을 이룬다. 카운터만 0으로 두면
 *  - 지난 실패 사유가 복구된 차량에 계속 붙어 보이고,
 *  - 통지 표식이 남아 **다음에 다시 끊겼을 때 기관에 알리지 못한다.**
 * 리셋 지점이 여러 곳이라 필드 목록이 갈라지기 쉬워 한 곳에 모은다.
 */
export const CALENDAR_FAIL_RESET_FIELDS = {
    calendarSyncFailCount: 0,
    calendarSyncLastFailReason: deleteField(),
    calendarSyncLastFailStatus: deleteField(),
    calendarSyncDisabledNotifiedAt: deleteField(),
} as const;
