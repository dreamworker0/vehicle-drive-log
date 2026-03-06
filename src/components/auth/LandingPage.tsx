/**
 * LandingPage — 서비스 소개 (비로그인 첫 화면)
 */
import { useNavigate } from 'react-router-dom';
import useForceLightMode from '../../hooks/useForceLightMode';

interface Feature {
    icon: string;
    title: string;
    desc: string;
}

const FEATURES: Feature[] = [
    {
        icon: '📝',
        title: '운행일지 자동화',
        desc: '계기판 촬영 한 번이면 주행거리가 자동 입력됩니다. 출발·도착 Km, 목적지, 동승자까지 간편하게 기록하세요.',
    },
    {
        icon: '📅',
        title: '차량 예약 시스템',
        desc: '달력에서 빈 시간을 골라 예약하면 끝. 중복 예약을 자동 차단하고, 예약 시간이 다가오면 알림을 보내드립니다.',
    },
    {
        icon: '📊',
        title: '통계 & 출력',
        desc: '월별 운행 통계, 직원별·목적별 현황을 한눈에. 공식 양식 PDF와 Excel로 바로 다운로드할 수 있습니다.',
    },
    {
        icon: '📱',
        title: '앱처럼 설치',
        desc: 'iPhone, Android 모두 지원. 홈 화면에 추가하면 네이티브 앱처럼 바로 실행할 수 있습니다.',
    },
];

interface SubFeature {
    icon: string;
    label: string;
}

const SUB_FEATURES: SubFeature[] = [
    { icon: '🗺️', label: '티맵 내비 연동' },
    { icon: '📴', label: '오프라인 지원' },
    { icon: '🔔', label: '푸시 알림' },
    { icon: '🔒', label: '기관별 데이터 격리' },
];

export default function LandingPage() {
    useForceLightMode();
    const navigate = useNavigate();

    return (
        <div className="min-h-screen flex flex-col bg-gradient-to-br from-primary-600 via-primary-700 to-primary-900 text-white">
            {/* 배경 장식 */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <div className="absolute -top-40 -right-40 w-80 h-80 bg-primary-400/20 rounded-full blur-3xl" />
                <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-primary-300/10 rounded-full blur-3xl" />
                <div className="absolute top-1/3 left-1/4 w-64 h-64 bg-accent-400/10 rounded-full blur-3xl" />
            </div>

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
                    차량 운행 기록부터 예약, 통계, 출력까지.<br />
                    복잡한 서류 업무를 스마트하게 해결합니다.
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

            {/* ─── 주요 기능 ─── */}
            <section className="relative bg-white dark:bg-surface-800 text-surface-900 dark:text-surface-100 px-4 py-16 sm:py-20">
                <div className="max-w-4xl mx-auto">
                    <h2 className="text-2xl font-bold text-center mb-10">주요 기능</h2>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
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
                        <span>영리 목적의 일반 기업은 이용 대상이 아닙니다</span>
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
