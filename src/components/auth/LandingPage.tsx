/**
 * LandingPage — 서비스 소개 (비로그인 첫 화면)
 */
import { useNavigate } from 'react-router-dom';
import useForceLightMode from '../../hooks/useForceLightMode';
import SEOHead from '../common/SEOHead';
import PublicNav from '../common/PublicNav';

interface Feature {
    icon: string;
    title: string;
    desc: string;
}

const FEATURES: Feature[] = [
    {
        icon: '🤖',
        title: 'AI 계기판 인식',
        desc: '계기판을 촬영하면 Gemini AI가 주행거리를 자동으로 읽어 입력합니다. 전기차 배터리 잔량도 한 번에 인식.',
    },
    {
        icon: '📝',
        title: '운행일지 자동화',
        desc: '즐겨찾기·빠른 출발로 반복 입력은 터치 한 번에. 예약 연동 시 차량·목적지·시간이 자동으로 채워집니다.',
    },
    {
        icon: '📅',
        title: '차량 예약 시스템',
        desc: '타임라인에서 빈 시간을 골라 예약하면 끝. 구글 캘린더와 양방향 동기화되어 일정 관리가 더 편리합니다.',
    },
    {
        icon: '🗺️',
        title: '길안내 앱 연동',
        desc: '네이버맵·카카오맵·티맵 중 원하는 앱을 골라 길안내를 시작하세요. 예상 거리·시간·톨비도 미리 확인.',
    },
    {
        icon: '📊',
        title: '통계·분석·출력',
        desc: '월별 운행 통계, 비용 분석 리포트, 직원별·목적별 현황을 한눈에. PDF·Excel로 바로 다운로드하세요.',
    },
    {
        icon: '🔧',
        title: '정비 기록 관리',
        desc: '정기 점검, 부품 교체, 수리 이력을 차량별로 체계적으로 관리합니다. 정비 중 차량 사용 자동 차단.',
    },
];

interface Step {
    num: string;
    title: string;
    desc: string;
}

const STEPS: Step[] = [
    {
        num: '1',
        title: '기관 신청',
        desc: '고유번호증 사진 한 장이면 AI가 자동 심사합니다. 빠르면 즉시 승인!',
    },
    {
        num: '2',
        title: '직원 초대',
        desc: '6자리 초대 코드를 직원에게 공유하세요. 구글 로그인만으로 바로 합류.',
    },
    {
        num: '3',
        title: '바로 사용',
        desc: '차량 등록 후 예약하고, 운행하고, 일지를 자동 작성하세요.',
    },
];

interface SubFeature {
    icon: string;
    label: string;
}

const SUB_FEATURES: SubFeature[] = [
    { icon: '⭐', label: '즐겨찾기·빠른 출발' },
    { icon: '📆', label: '구글 캘린더 연동' },
    { icon: '🔔', label: '푸시 알림' },
    { icon: '📴', label: '오프라인 지원' },
    { icon: '🌙', label: '다크 모드' },
    { icon: '🔠', label: '글꼴 크기 조절' },
    { icon: '🔒', label: '기관별 데이터 격리' },
    { icon: '💾', label: '매일 자동 백업' },
    { icon: '📖', label: '사용 매뉴얼·영상 가이드' },
    { icon: '💬', label: '의견 보내기' },
];

export default function LandingPage() {
    useForceLightMode();
    const navigate = useNavigate();

    return (
        <div className="min-h-screen flex flex-col bg-gradient-to-br from-primary-600 via-primary-700 to-primary-900 text-white">
            <SEOHead
                title="차량 운행일지 - 사회복지기관·비영리단체 전용"
                description="AI 계기판 인식, 예약, 길안내, 정비, 통계, 출력까지. 사회복지기관을 위한 무료 차량 관리 서비스."
                path="/"
                isHome
            />
            {/* 배경 장식 */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <div className="absolute -top-40 -right-40 w-80 h-80 bg-primary-400/20 rounded-full blur-3xl" />
                <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-primary-300/10 rounded-full blur-3xl" />
                <div className="absolute top-1/3 left-1/4 w-64 h-64 bg-accent-400/10 rounded-full blur-3xl" />
            </div>

            {/* ─── 상단 네비게이션 ─── */}
            <PublicNav variant="overlay" />

            {/* ─── 히어로 ─── */}
            <header className="relative flex-1 flex flex-col items-center justify-center text-center px-4 py-16 sm:py-24">
                <div className="w-20 h-20 mx-auto mb-6 bg-white/10 dark:bg-surface-800/10 backdrop-blur-md rounded-2xl flex items-center justify-center border border-white/20 animate-scale-in" aria-hidden="true">
                    <svg className="w-10 h-10 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 0 1-3 0 m3 0a1.5 1.5 0 0 0-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 0 1-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 0 0-3.213-9.193 2.056 2.056 0 0 0-1.58-.86H14.25M16.5 18.75h-2.25m0-11.177v-.958c0-.568-.422-1.048-.987-1.106a48.554 48.554 0 0 0-10.026 0 1.106 1.106 0 0 0-.987 1.106v7.635m12-6.677v6.677m0 4.5v-4.5m0 0h-12" />
                    </svg>
                </div>

                <h1 className="text-3xl sm:text-4xl font-bold mb-3 animate-fade-in">차량 운행일지</h1>
                <p className="text-primary-200 text-base sm:text-lg max-w-md mb-2 animate-fade-in">
                    사회복지기관·비영리단체 전용
                </p>
                <p className="text-primary-300/80 text-sm max-w-sm mb-8 animate-fade-in">
                    AI 계기판 인식, 예약, 길안내, 정비, 통계, 출력까지.<br />
                    차량 관리의 모든 것을 하나로 해결합니다.
                </p>

                <div className="flex flex-col sm:flex-row gap-3 w-full max-w-xs sm:max-w-md animate-fade-in">
                    <button
                        onClick={() => navigate('/apply')}
                        className="flex-1 btn bg-white dark:bg-surface-800 text-primary-700 font-bold hover:bg-primary-50 shadow-lg hover:shadow-xl transition-all"
                    >
                        기관 신청하기
                    </button>
                    <button
                        onClick={() => navigate('/login')}
                        className="flex-1 btn bg-white/10 dark:bg-surface-800/10 backdrop-blur-sm text-white border border-white/20 hover:bg-white/20 transition-all"
                    >
                        로그인
                    </button>
                </div>

                <p className="mt-4 text-primary-300/60 text-xs">✨ 완전 무료 · 광고 없음</p>
            </header>

            {/* ─── 3단계로 시작하세요 ─── */}
            <section className="relative bg-primary-800/50 backdrop-blur-sm px-4 py-12 sm:py-16">
                <div className="max-w-3xl mx-auto">
                    <h2 className="text-2xl font-bold text-center mb-10">3단계로 시작하세요</h2>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                        {STEPS.map((s) => (
                            <div key={s.num} className="text-center">
                                <div className="w-12 h-12 mx-auto mb-4 bg-white/10 rounded-full flex items-center justify-center text-xl font-bold border border-white/20">
                                    {s.num}
                                </div>
                                <h3 className="text-lg font-semibold mb-2">{s.title}</h3>
                                <p className="text-primary-200/80 text-sm leading-relaxed">{s.desc}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* ─── 사용법 영상 ─── */}
            <section className="relative bg-primary-700/50 backdrop-blur-sm px-4 py-12 sm:py-16">
                <div className="max-w-2xl mx-auto text-center">
                    <h2 className="text-2xl font-bold mb-2">📺 사용법 영상</h2>
                    <p className="text-primary-200/80 text-sm mb-6">
                        영상으로 사용법을 확인해보세요.
                    </p>
                    <div className="relative w-full overflow-hidden rounded-xl" style={{ paddingBottom: '56.25%' }}>
                        <iframe
                            className="absolute top-0 left-0 w-full h-full"
                            src="https://www.youtube.com/embed/XdT5Wm_pd3s?rel=0&modestbranding=1"
                            title="차량 운행일지 사용법"
                            loading="lazy"
                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                            referrerPolicy="strict-origin-when-cross-origin"
                            allowFullScreen
                        />
                    </div>
                </div>
            </section>

            {/* ─── 주요 기능 ─── */}
            <section className="relative bg-white dark:bg-surface-800 text-surface-900 dark:text-surface-100 px-4 py-16 sm:py-20">
                <div className="max-w-4xl mx-auto">
                    <h2 className="text-2xl font-bold text-center mb-10">주요 기능</h2>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                        {FEATURES.map((f) => (
                            <div
                                key={f.title}
                                className="bg-surface-50 dark:bg-surface-800 rounded-2xl p-6 text-center hover:shadow-lg transition-shadow"
                            >
                                <div className="text-4xl mb-4">{f.icon}</div>
                                <h3 className="text-lg font-semibold mb-2">{f.title}</h3>
                                <p className="text-sm text-surface-500 dark:text-surface-400 leading-relaxed">{f.desc}</p>
                            </div>
                        ))}
                    </div>

                    {/* 부가 기능 칩 */}
                    <div className="flex flex-wrap justify-center gap-3 mt-10">
                        {SUB_FEATURES.map((s) => (
                            <span
                                key={s.label}
                                className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary-50 text-primary-700 rounded-full text-sm font-medium"
                            >
                                {s.icon} {s.label}
                            </span>
                        ))}
                    </div>
                </div>
            </section>

            {/* ─── 대상 안내 ─── */}
            <section className="relative bg-surface-50 dark:bg-surface-800 text-surface-900 dark:text-surface-100 px-4 py-12 sm:py-16">
                <div className="max-w-2xl mx-auto text-center">
                    <h2 className="text-xl font-bold mb-4">누가 사용할 수 있나요?</h2>
                    <p className="text-surface-600 dark:text-surface-400 text-sm leading-relaxed mb-6">
                        사회복지법인, 사회복지시설, 비영리사단법인·재단법인 등<br />
                        <strong>고유번호증 또는 사업자등록증을 보유한 비영리단체</strong>라면 누구나 신청할 수 있습니다.
                    </p>
                    <div className="inline-flex items-center gap-2 bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-4 py-2 text-sm">
                        <span>⚠️</span>
                        <span>영리 기업 및 종교단체, 학교, 병원은 이용 대상이 아닙니다</span>
                    </div>
                </div>
            </section>

            {/* ─── CTA ─── */}
            <section className="relative bg-primary-800 text-white px-4 py-12 sm:py-16 text-center">
                <h2 className="text-xl font-bold mb-2">지금 바로 시작하세요</h2>
                <p className="text-primary-300 text-sm mb-6">신청부터 승인까지 보통 1~2 영업일이면 완료됩니다.</p>
                <button
                    onClick={() => navigate('/apply')}
                    className="btn bg-white dark:bg-surface-800 text-primary-700 font-bold hover:bg-primary-50 shadow-lg hover:shadow-xl transition-all"
                >
                    기관 사용 신청하기
                </button>
            </section>

            {/* ─── 푸터 ─── */}
            <footer className="relative bg-primary-900 text-primary-300/60 text-center text-xs px-4 py-6 space-y-2" role="contentinfo">
                <nav className="space-x-2" aria-label="법적 고지">
                    <a href="/terms" className="hover:text-white underline underline-offset-2 transition-colors">이용약관</a>
                    <span className="text-primary-300/30" aria-hidden="true">|</span>
                    <a href="/privacy" className="hover:text-white underline underline-offset-2 transition-colors">개인정보 처리방침</a>
                </nav>
                <p>© 2026 차량 운행일지. All rights reserved.</p>
            </footer>
        </div>
    );
}
