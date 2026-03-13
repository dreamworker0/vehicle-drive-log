/**
 * releaseNotes — 사용자용 업데이트 소식 데이터
 *
 * 서비스 이용자가 이해할 수 있는 변경 사항만 기술합니다.
 * 기술 용어(컴포넌트명, Firestore, Cloud Functions 등)는 사용하지 않습니다.
 */

export interface ReleaseItem {
    type: 'new' | 'improved' | 'fixed';
    text: string;
}

export interface ReleaseNote {
    date: string;
    title?: string;
    items: ReleaseItem[];
}

export const RELEASE_NOTES: ReleaseNote[] = [
    {
        date: '2026-03-12',
        title: '예약 화면 개선 & 성능 최적화',
        items: [
            { type: 'improved', text: '예약 폼에서 날짜를 먼저 선택하고, 시간을 그 아래에서 선택하도록 순서가 개선되었습니다.' },
            { type: 'improved', text: '시작일 표시가 종료일과 같은 형식(YYYY-MM-DD 요일)으로 통일되었습니다.' },
            { type: 'improved', text: 'PDF 출력 시 날짜·시간순 정렬이 적용됩니다.' },
            { type: 'improved', text: '운행 기록 목록 로딩 속도가 개선되었습니다.' },
        ],
    },
    {
        date: '2026-03-11',
        title: '운행 밀도 히트맵 & 안정성 개선',
        items: [
            { type: 'new', text: '운행 분석에 요일×시간대 운행 밀도 히트맵이 추가되었습니다.' },
            { type: 'improved', text: '새 탭에서 로그아웃되던 문제가 해결되었습니다.' },
            { type: 'fixed', text: '삭제 후 재생성된 기관의 직원 로그인 문제를 수정했습니다.' },
            { type: 'fixed', text: '운행일지 수정 시 출발Km가 잘못 변경되던 문제를 수정했습니다.' },
        ],
    },
    {
        date: '2026-03-09',
        title: '🎉 서비스 출시 & 사용성 강화',
        items: [
            { type: 'new', text: '사용 매뉴얼에 YouTube 영상 가이드 링크가 추가되었습니다.' },
            { type: 'improved', text: '랜딩 페이지 안내 문구가 더 명확하게 개선되었습니다.' },
        ],
    },
    {
        date: '2026-03-07',
        title: '직원 목록 통합',
        items: [
            { type: 'new', text: '활성·가입 대기·비활성 직원을 하나의 통합 목록에서 확인할 수 있습니다.' },
            { type: 'improved', text: '직원 검색이 모든 상태(활성/대기/비활성)에 통합 적용됩니다.' },
        ],
    },
    {
        date: '2026-03-05',
        title: '차량 보험 정보 & 길안내 앱 설정',
        items: [
            { type: 'new', text: '차량별 보험사 정보(보험사명, 전화번호)를 등록하고 조회할 수 있습니다.' },
            { type: 'new', text: '더보기 → 차량 보험 정보에서 보험사 전화를 바로 걸 수 있습니다.' },
            { type: 'improved', text: '길안내 앱을 네이버/카카오/티맵 중 선택할 수 있도록 설정이 추가되었습니다.' },
        ],
    },
    {
        date: '2026-03-03',
        title: 'OCR 오류 신고',
        items: [
            { type: 'new', text: '계기판 인식 오류 시 "오류 제보" 버튼으로 간편하게 신고할 수 있습니다.' },
        ],
    },
    {
        date: '2026-03-02',
        title: '설정 페이지 정리',
        items: [
            { type: 'improved', text: '설정 페이지가 기관 정보 → 공휴일 → 계정 → 알림 → 가이드 순으로 재배치되었습니다.' },
            { type: 'improved', text: '공휴일 관리 화면이 연도 선택 + 3열 그리드로 개선되었습니다.' },
        ],
    },
    {
        date: '2026-03-01',
        title: '다중 목적지 & 글꼴 크기 조절',
        items: [
            { type: 'new', text: '여러 목적지를 한 번에 입력하면 최적 경로를 자동 탐색합니다.' },
            { type: 'new', text: '글꼴 크기를 작게/보통/크게 3단계로 조절할 수 있습니다.' },
            { type: 'improved', text: 'AI 계기판 인식 성능이 향상되었습니다.' },
            { type: 'new', text: '예약 화면에서 즐겨찾기를 바로 등록할 수 있습니다.' },
        ],
    },
    {
        date: '2026-02-28',
        title: '동시 운행 제한 & 내 기록 개선',
        items: [
            { type: 'new', text: '운행 중에는 다른 예약의 운행 시작 버튼이 비활성화됩니다.' },
            { type: 'improved', text: '내 기록 목록에서 날짜가 축약 형식(M/D 요일)으로 표시됩니다.' },
            { type: 'improved', text: '알림 설정이 설정 페이지 안으로 이동되었습니다.' },
        ],
    },
    {
        date: '2026-02-27',
        title: '앱 속도 개선 & 예약 안정화',
        items: [
            { type: 'improved', text: '앱 초기 로딩 속도가 약 40% 빨라졌습니다.' },
            { type: 'improved', text: '과거 시간대에는 예약을 생성할 수 없도록 차단됩니다.' },
            { type: 'improved', text: '모달 팝업에 키보드(ESC) 닫기가 지원됩니다.' },
        ],
    },
    {
        date: '2026-02-26',
        title: '정비 기록 확장 & 확인 팝업 개선',
        items: [
            { type: 'new', text: '정비 기록을 Excel/PDF로 다운로드할 수 있습니다.' },
            { type: 'new', text: '정비 기록에 검색/필터 기능이 추가되었습니다.' },
            { type: 'improved', text: '확인 팝업이 앱 디자인에 맞는 모달로 교체되었습니다.' },
            { type: 'fixed', text: '로그인 시 간헐적으로 발생하던 오류를 수정했습니다.' },
            { type: 'fixed', text: '운행일지 Km 값이 잘못 덮어쓰이던 문제를 수정했습니다.' },
        ],
    },
    {
        date: '2026-02-27',
        title: '예약 없이 운행 & 차량 관리 강화',
        items: [
            { type: 'new', text: '예약 없이 "빠른 출발" 버튼으로 바로 운행을 시작할 수 있습니다.' },
            { type: 'new', text: '차량 퇴역/복귀 기능이 추가되었습니다.' },
            { type: 'new', text: '정비 중인 차량은 자동으로 예약/운행이 차단됩니다.' },
            { type: 'new', text: '차량별 예약 현황을 타임라인 바로 한눈에 확인할 수 있습니다.' },
            { type: 'new', text: '관리자가 전 직원의 예약을 조회/수정/취소할 수 있습니다.' },
            { type: 'improved', text: 'PDF 결재란을 기관 설정에 맞게 커스터마이징할 수 있습니다.' },
        ],
    },
    {
        date: '2026-02-25',
        title: '구글 캘린더 연동 & 공지 기능',
        items: [
            { type: 'new', text: '구글 캘린더에서 추가한 일정이 앱 예약에 자동 반영됩니다.' },
            { type: 'new', text: '관리자가 기관 전체에 공지를 전송할 수 있습니다.' },
            { type: 'new', text: '예약 취소/변경 시 자동으로 푸시 알림이 전송됩니다.' },
        ],
    },
    {
        date: '2026-02-22',
        title: '푸시 알림 & 오프라인 지원',
        items: [
            { type: 'new', text: '예약 10분 전, 운행일지 미작성 시 푸시 알림이 발송됩니다.' },
            { type: 'new', text: '인터넷이 끊겨도 앱을 계속 사용할 수 있으며, 연결 복구 시 자동 동기화됩니다.' },
            { type: 'new', text: '의견 보내기 기능으로 개선 제안을 전달할 수 있습니다.' },
            { type: 'new', text: '앱 내 사용 매뉴얼이 추가되었습니다.' },
        ],
    },
    {
        date: '2026-02-20',
        title: 'PDF/Excel 출력 & 차량 예약',
        items: [
            { type: 'new', text: '운행일지를 공식 양식 PDF로 다운로드할 수 있습니다.' },
            { type: 'new', text: '운행일지를 Excel 파일로 다운로드할 수 있습니다.' },
            { type: 'new', text: '월별 운행 통계 대시보드가 추가되었습니다.' },
            { type: 'new', text: '달력 기반 차량 예약 시스템이 추가되었습니다.' },
            { type: 'new', text: '구글 캘린더와 예약이 자동 동기화됩니다.' },
            { type: 'new', text: '차량 정비/수리 기록을 관리할 수 있습니다.' },
            { type: 'new', text: '다크 모드를 지원합니다.' },
        ],
    },
    {
        date: '2026-02-18',
        title: '개발 시작',
        items: [
            { type: 'new', text: 'AI 계기판 인식으로 주행거리를 자동 입력합니다.' },
            { type: 'new', text: 'AI 기관 인증으로 고유번호증을 자동 심사합니다.' },
            { type: 'new', text: '운행일지 작성, 조회, 수정 기능을 제공합니다.' },
            { type: 'new', text: '직원 초대 코드로 기관에 합류할 수 있습니다.' },
            { type: 'new', text: '차량 등록 및 관리 기능을 제공합니다.' },
            { type: 'new', text: '티맵 내비게이션 연동을 지원합니다.' },
            { type: 'new', text: 'Google 계정으로 간편하게 로그인합니다.' },
        ],
    },
];
