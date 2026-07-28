import { useNavigate } from 'react-router-dom';
import SEOHead from '../common/SEOHead';
import useForceLightMode from '../../hooks/useForceLightMode';

/**
 * 개인정보 처리 수탁자 목록 (제7조 위탁 / 제8조 국외 이전 공통 원본)
 *
 * 실제 코드에서 개인정보가 나가는 경로와 1:1로 대응한다.
 * 외부 연동을 추가·제거하면 이 배열도 반드시 함께 갱신해야 한다.
 * - Firebase/Analytics: src/lib/firebase.ts, functions/src/core/firebase.ts
 * - Gemini: functions/src/handlers/callable/{ocrDashboard,askAI}.ts,
 *           functions/src/handlers/triggers/{autoVerifyDocument,generateFeedbackDraft}.ts,
 *           functions/src/services/assistant/
 * - Gmail: functions/src/core/mailer.ts 사용처
 * - EmailJS: functions/src/services/driveLog/verifyHelpers.ts (승인 메일 트리거 경로)
 * - Calendar: functions/src/services/calendar/calendarSync.ts
 * - 알리고·Cafe24: functions/src/services/alimtalk/sendAlimtalk.ts
 * - Discord: functions/src/core/discord.ts 의 sendDiscordAlert 호출부 전부
 * - Slack: functions/src/services/slack
 * - Sentry: src/lib/sentry.ts, functions/src/core/sentry.ts
 *
 * 의도적 제외(개인 식별정보가 전달되지 않아 수탁자로 보지 않음):
 * Tmap 경로 API(목적지 문자열·좌표만, 프록시 경유로 이용자 IP 미전달),
 * 공공데이터포털 공휴일 API(개인정보 없음).
 */
const PROCESSORS: {
    /** 수탁자(법인명) */
    name: string;
    /** 이전받는 국가 */
    country: string;
    /** 위탁 업무 내용 = 이전받는 자의 이용 목적 */
    task: string;
    /** 이전되는 개인정보 항목 */
    items: string;
    /** 수탁자 개인정보 문의처 */
    contact: string;
    /** 기관이 별도로 연동을 설정한 경우에만 발생하는지 여부 */
    optional?: boolean;
}[] = [
    {
        name: 'Google LLC (Firebase)',
        country: '미국',
        task: '이용자 인증, 데이터베이스·파일 저장, 웹 호스팅, 푸시 알림 발송, 서비스 이용 통계 분석',
        items: '이메일 주소, 이름, 전화번호, 운행일지·차량·예약 데이터, 증빙서류 사본, 접속 기기·이용 기록',
        contact: 'https://support.google.com/policies/troubleshooter/7575787',
    },
    {
        name: 'Google LLC (Gemini API)',
        country: '미국',
        task: '계기판 사진의 주행거리·배터리 잔량 판독, 비영리 증빙서류 유형 자동 판별, 문의 답변 초안 생성, 챗봇 질문 응답',
        items: '계기판 사진, 비영리 증빙서류 이미지, 문의·질문 내용 및 첨부 이미지, 예약자 이름·예약 일시·용도·목적지·차량명',
        contact: 'https://support.google.com/policies/troubleshooter/7575787',
    },
    {
        name: 'Google LLC (Gmail)',
        country: '미국',
        task: '기관 신청 승인·반려 안내, 문의 답변, 운영자 알림 메일 발송',
        items: '이메일 주소, 이름, 전화번호, 기관명, 문의·답변 내용, 반려 사유',
        contact: 'https://support.google.com/policies/troubleshooter/7575787',
    },
    {
        name: 'EmailJS Pte. Ltd.',
        country: '싱가포르 (서버 소재: 미국)',
        task: '기관 신청 자동 승인 안내 메일 발송',
        items: '이메일 주소, 이름, 기관명, 초대 코드',
        contact: 'https://www.emailjs.com/legal/privacy-policy/',
    },
    {
        name: 'Google LLC (Google Calendar)',
        country: '미국',
        task: '차량 예약 일정의 캘린더 동기화',
        items: '예약자 이름, 예약 일시·용도·목적지, 차량명',
        contact: 'https://support.google.com/policies/troubleshooter/7575787',
        optional: true,
    },
    {
        name: '(주)알리고',
        country: '대한민국',
        task: '기관 신청 승인·반려 및 등록 안내 카카오 알림톡 발송',
        items: '휴대전화번호, 이름, 기관명, 초대 코드, 반려 사유',
        contact: 'https://smartsms.aligo.in',
    },
    {
        name: '카페24 주식회사 (Cafe24)',
        country: '대한민국',
        task: '알림톡 발송 요청의 중계(프록시) 서버 운영',
        items: '휴대전화번호, 이름, 기관명, 초대 코드, 반려 사유',
        contact: 'https://www.cafe24.com',
    },
    {
        name: 'Discord Inc.',
        country: '미국',
        task: '신규 기관 신청, 관리자 권한 변경, 이용자 의견 접수, 시스템 오류의 운영자 실시간 알림',
        items: '이름, 이메일 주소, 전화번호, 기관명, 문의·의견 내용',
        contact: 'privacy@discord.com',
    },
    {
        name: 'Slack Technologies, LLC',
        country: '미국',
        task: '차량 예약 알림 발송 및 챗봇 문의 응답',
        items: '예약자 이름, 예약 일시·용도·목적지, 이메일 주소(계정 매칭용), Slack 계정 식별자',
        contact: 'privacy@slack.com',
        optional: true,
    },
    {
        name: 'Functional Software, Inc. (Sentry)',
        country: '미국',
        task: '서비스 오류 수집 및 안정성 모니터링',
        items: '이메일 주소, 사용자 식별자, 소속 기관 식별자, 오류 발생 시점의 접속 기록·브라우저 정보',
        contact: 'compliance@sentry.io',
    },
];

/** 국외로 이전되는 수탁자만 추린 목록 (제8조) */
const OVERSEAS_PROCESSORS = PROCESSORS.filter((p) => p.country !== '대한민국');

export default function PrivacyPage() {
    const navigate = useNavigate();
    // 다른 공개 페이지와 동일하게 강제 라이트 (배경에 dark 변형이 없어 다크가 남으면 대비가 깨진다)
    useForceLightMode();

    return (
        <div className="min-h-screen bg-gradient-to-br from-surface-50 to-primary-50 py-8 px-4">
            <SEOHead
                title="개인정보 처리방침"
                description="차량 운행일지 서비스의 개인정보 수집·이용·위탁·국외 이전 및 보호에 관한 방침입니다."
                path="/privacy"
            />
            <div className="w-full max-w-2xl mx-auto animate-fade-in">
                {/* 뒤로가기 */}
                <button
                    onClick={() => navigate(-1)}
                    className="flex items-center gap-1.5 text-sm text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-300 dark:text-surface-300 mb-6 transition-colors min-h-[48px] px-2 -ml-2"
                >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
                    </svg>
                    돌아가기
                </button>

                <div className="bg-white dark:bg-surface-800 rounded-2xl shadow-soft p-6 md:p-8 space-y-8">
                    <div className="text-center border-b border-surface-100 dark:border-surface-700 pb-6">
                        <h1 className="text-2xl font-bold text-surface-900 dark:text-surface-100 mb-1">개인정보 처리방침</h1>
                        <p className="text-sm text-surface-400 dark:text-surface-500">시행일: 2026년 8월 5일 (최초 시행: 2026년 2월 1일)</p>
                    </div>

                    {/* 제1조 */}
                    <section className="space-y-3">
                        <h2 className="text-lg font-semibold text-surface-800 dark:text-surface-200">제1조 (수집하는 개인정보 항목)</h2>
                        <div className="text-sm text-surface-600 dark:text-surface-400 leading-relaxed space-y-3">
                            <p>서비스는 다음의 개인정보를 수집합니다.</p>

                            <div className="bg-surface-50 dark:bg-surface-800 rounded-xl p-4 space-y-2">
                                <p className="font-medium text-surface-700 dark:text-surface-300">필수 수집 항목</p>
                                <ul className="list-disc list-inside space-y-1 ml-2">
                                    <li>이메일 주소 (Google 로그인을 통해 자동 수집)</li>
                                    <li>이름 (Google 계정 표시 이름)</li>
                                </ul>
                            </div>

                            <div className="bg-surface-50 dark:bg-surface-800 rounded-xl p-4 space-y-2">
                                <p className="font-medium text-surface-700 dark:text-surface-300">선택 수집 항목</p>
                                <ul className="list-disc list-inside space-y-1 ml-2">
                                    <li>전화번호 (기관 신청 시)</li>
                                </ul>
                            </div>

                            <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 dark:bg-blue-900/20 dark:border-blue-800">
                                <p className="font-medium text-blue-800 dark:text-blue-300 mb-1">🔒 비밀번호 미저장</p>
                                <p className="text-blue-700 dark:text-blue-400 text-xs">
                                    본 서비스는 Google OAuth 2.0을 통해 인증하며,
                                    비밀번호를 직접 저장하거나 관리하지 않습니다.
                                </p>
                            </div>
                        </div>
                    </section>

                    {/* 제2조 */}
                    <section className="space-y-3">
                        <h2 className="text-lg font-semibold text-surface-800 dark:text-surface-200">제2조 (개인정보의 이용 목적)</h2>
                        <div className="text-sm text-surface-600 dark:text-surface-400 leading-relaxed">
                            <ul className="list-disc list-inside space-y-1 ml-2">
                                <li>서비스 이용자 식별 및 인증</li>
                                <li>기관 사용 신청 처리 및 승인 연락</li>
                                <li>운행일지 작성자 기록</li>
                                <li>차량 예약 관리</li>
                                <li>서비스 운영 관련 공지 전달</li>
                            </ul>
                        </div>
                    </section>

                    {/* 제3조 */}
                    <section className="space-y-3">
                        <h2 className="text-lg font-semibold text-surface-800 dark:text-surface-200">제3조 (AI 처리 및 이미지 데이터)</h2>
                        <div className="text-sm text-surface-600 dark:text-surface-400 leading-relaxed space-y-3">
                            <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 dark:bg-amber-900/20 dark:border-amber-800">
                                <p className="font-medium text-amber-800 dark:text-amber-300 mb-2">📷 계기판 사진 처리</p>
                                <ul className="list-disc list-inside space-y-1 ml-2 text-amber-700 dark:text-amber-400 text-xs">
                                    <li>계기판 사진은 <strong>Google Gemini API</strong>를 통해 서버사이드에서 분석됩니다.</li>
                                    <li>분석 목적: 누적 주행거리(Km), 배터리 잔량(%) 숫자 추출</li>
                                    <li>사진은 분석 완료 후 <strong>즉시 폐기</strong>되며, 서버나 스토리지에 저장되지 않습니다.</li>
                                </ul>
                            </div>

                            <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 dark:bg-amber-900/20 dark:border-amber-800">
                                <p className="font-medium text-amber-800 dark:text-amber-300 mb-2">📄 비영리 증빙서류 처리</p>
                                <ul className="list-disc list-inside space-y-1 ml-2 text-amber-700 dark:text-amber-400 text-xs">
                                    <li>비영리 증빙서류(고유번호증 또는 사업자등록증)는 기관 신청 심사 목적으로 업로드됩니다.</li>
                                    <li>AI(Google Gemini API)가 문서 유형을 판별하고 기관 정보를 추출합니다.</li>
                                    <li>업로드된 사본은 Firebase Storage에 암호화되어 저장되며, <strong>심사 완료(승인) 후 30일 경과 시 자동 삭제</strong>됩니다.</li>
                                </ul>
                            </div>

                            <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 dark:bg-amber-900/20 dark:border-amber-800">
                                <p className="font-medium text-amber-800 dark:text-amber-300 mb-2">💬 문의 답변 및 챗봇 응답</p>
                                <ul className="list-disc list-inside space-y-1 ml-2 text-amber-700 dark:text-amber-400 text-xs">
                                    <li>서비스 내 문의·의견의 답변 초안 작성에 AI(Google Gemini API)가 사용되며, 문의 내용과 첨부 이미지가 전달됩니다.</li>
                                    <li>챗봇에 예약 관련 질문을 하는 경우, 소속 기관의 예약 목록(예약자 이름·일시·용도·목적지)이 답변 근거로 함께 전달됩니다.</li>
                                    <li>전달 범위는 <strong>질문자가 속한 기관의 데이터로 한정</strong>되며, 다른 기관의 데이터는 포함되지 않습니다.</li>
                                </ul>
                            </div>

                            <p className="text-xs">
                                Google Gemini API는 미국에 소재한 Google LLC가 운영하므로, 위 정보는 처리 과정에서 국외로 이전됩니다.
                                자세한 내용은 <strong>제7조(위탁)</strong> 및 <strong>제8조(국외 이전)</strong>를 참고해 주십시오.
                            </p>
                        </div>
                    </section>

                    {/* 제4조 */}
                    <section className="space-y-3">
                        <h2 className="text-lg font-semibold text-surface-800 dark:text-surface-200">제4조 (데이터 소유권 및 보존)</h2>
                        <div className="text-sm text-surface-600 dark:text-surface-400 leading-relaxed space-y-3">
                            <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 dark:bg-green-900/20 dark:border-green-800">
                                <p className="font-medium text-green-800 dark:text-green-300 mb-2">🏢 데이터 소유</p>
                                <p className="text-green-700 dark:text-green-400 text-xs">
                                    서비스 내 모든 운행일지, 차량 정보, 예약 데이터는 <strong>해당 기관의 소유</strong>입니다.
                                    기관 삭제 시 해당 기관의 모든 데이터가 완전히 삭제됩니다.
                                </p>
                            </div>

                            <div className="space-y-2">
                                <p className="font-medium text-surface-700 dark:text-surface-300">보존 기간</p>
                                <ul className="list-disc list-inside space-y-1 ml-2">
                                    <li>
                                        운행일지 데이터: 지자체 감사 대응을 위해 <strong>최소 3년~5년</strong> 보존을 권장합니다.
                                    </li>
                                    <li>기관 삭제를 요청하지 않는 한 데이터는 유지됩니다.</li>
                                </ul>
                            </div>
                        </div>
                    </section>

                    {/* 제5조 */}
                    <section className="space-y-3">
                        <h2 className="text-lg font-semibold text-surface-800 dark:text-surface-200">제5조 (탑승자 정보 정책)</h2>
                        <div className="text-sm text-surface-600 dark:text-surface-400 leading-relaxed">
                            <div className="bg-purple-50 border border-purple-200 rounded-xl px-4 py-3 dark:bg-purple-900/20 dark:border-purple-800">
                                <p className="font-medium text-purple-800 dark:text-purple-300 mb-2">👥 탑승자 이름 기록 원칙</p>
                                <ul className="list-disc list-inside space-y-1 ml-2 text-purple-700 dark:text-purple-400 text-xs">
                                    <li>운행일지의 탑승자란에는 <strong>소속 직원의 이름만</strong> 기록합니다.</li>
                                    <li>서비스 이용자(클라이언트)의 이름은 개인정보 보호를 위해 <strong>기록하지 않습니다</strong>.</li>
                                </ul>
                            </div>
                        </div>
                    </section>

                    {/* 제6조 */}
                    <section className="space-y-3">
                        <h2 className="text-lg font-semibold text-surface-800 dark:text-surface-200">제6조 (개인정보의 제3자 제공)</h2>
                        <div className="text-sm text-surface-600 dark:text-surface-400 leading-relaxed space-y-2">
                            <p>
                                서비스는 이용자의 개인정보를 제3자에게 제공하지 않습니다.
                                다만, 법령에 의한 요청이 있는 경우 관련 법률에 따라 제공될 수 있습니다.
                            </p>
                            <p className="text-xs">
                                단, 서비스 운영에 필요한 범위에서 <strong>제7조</strong>와 같이 개인정보 처리업무를 외부에 위탁하고 있습니다.
                                위탁은 서비스 제공을 위해 처리를 대행하게 하는 것으로, 수탁자가 자신의 목적으로 이용하는 제3자 제공과는 구분됩니다.
                            </p>
                        </div>
                    </section>

                    {/* 제7조 */}
                    <section className="space-y-3">
                        <h2 className="text-lg font-semibold text-surface-800 dark:text-surface-200">제7조 (개인정보 처리업무의 위탁)</h2>
                        <div className="text-sm text-surface-600 dark:text-surface-400 leading-relaxed space-y-3">
                            <p>서비스는 원활한 운영을 위하여 다음과 같이 개인정보 처리업무를 위탁하고 있습니다.</p>

                            <div className="rounded-xl border border-surface-200 dark:border-surface-700 divide-y divide-surface-100 dark:divide-surface-700 overflow-hidden">
                                {PROCESSORS.map((p) => (
                                    <div key={`${p.name}-${p.task}`} className="p-4 space-y-1.5 bg-surface-50 dark:bg-surface-800/60">
                                        <p className="font-medium text-surface-700 dark:text-surface-300 flex flex-wrap items-center gap-x-2 gap-y-1">
                                            <span>{p.name}</span>
                                            {p.optional && (
                                                <span className="text-[11px] font-normal px-1.5 py-0.5 rounded-md bg-surface-200 text-surface-600 dark:bg-surface-700 dark:text-surface-300">
                                                    기관 선택 연동 시
                                                </span>
                                            )}
                                        </p>
                                        <p className="text-xs">
                                            <span className="text-surface-400 dark:text-surface-500">위탁 업무 · </span>
                                            {p.task}
                                        </p>
                                        <p className="text-xs">
                                            <span className="text-surface-400 dark:text-surface-500">처리 항목 · </span>
                                            {p.items}
                                        </p>
                                    </div>
                                ))}
                            </div>

                            <ul className="list-disc list-inside space-y-1 ml-2 text-xs">
                                <li>
                                    카카오 알림톡은 카페24 주식회사가 제공하는 호스팅 환경의 중계 서버를 거쳐 (주)알리고로 전달되며,
                                    최종 발송은 카카오톡을 통해 이루어집니다. 중계 서버는 발송 요청을 전달할 뿐 별도로 개인정보를 저장하지 않습니다.
                                </li>
                                <li>
                                    &lsquo;기관 선택 연동 시&rsquo; 항목은 기관관리자가 해당 연동을 직접 설정한 경우에만 발생하며,
                                    설정하지 않으면 개인정보가 전달되지 않습니다.
                                </li>
                                <li>
                                    위탁 업무의 내용이나 수탁자가 변경될 경우 본 개인정보 처리방침을 통해 지체 없이 공개합니다.
                                </li>
                            </ul>
                        </div>
                    </section>

                    {/* 제8조 */}
                    <section className="space-y-3">
                        <h2 className="text-lg font-semibold text-surface-800 dark:text-surface-200">제8조 (개인정보의 국외 이전)</h2>
                        <div className="text-sm text-surface-600 dark:text-surface-400 leading-relaxed space-y-3">
                            <p>
                                제7조의 수탁자 중 다음 사업자는 국외에 소재하므로, 위탁 업무 수행 과정에서 개인정보가 국외로 이전됩니다.
                            </p>

                            <div className="rounded-xl border border-surface-200 dark:border-surface-700 divide-y divide-surface-100 dark:divide-surface-700 overflow-hidden">
                                {OVERSEAS_PROCESSORS.map((p) => (
                                    <div key={`overseas-${p.name}-${p.task}`} className="p-4 space-y-1.5 bg-surface-50 dark:bg-surface-800/60">
                                        <p className="font-medium text-surface-700 dark:text-surface-300 flex flex-wrap items-center gap-x-2 gap-y-1">
                                            <span>{p.name}</span>
                                            <span className="text-[11px] font-normal px-1.5 py-0.5 rounded-md bg-surface-200 text-surface-600 dark:bg-surface-700 dark:text-surface-300">
                                                {p.country}
                                            </span>
                                        </p>
                                        <p className="text-xs">
                                            <span className="text-surface-400 dark:text-surface-500">이전 항목 · </span>
                                            {p.items}
                                        </p>
                                        <p className="text-xs">
                                            <span className="text-surface-400 dark:text-surface-500">이용 목적 · </span>
                                            {p.task}
                                        </p>
                                        <p className="text-xs break-all">
                                            <span className="text-surface-400 dark:text-surface-500">문의처 · </span>
                                            {p.contact}
                                        </p>
                                    </div>
                                ))}
                            </div>

                            <div className="space-y-2">
                                <p className="font-medium text-surface-700 dark:text-surface-300">이전 시기 및 방법</p>
                                <ul className="list-disc list-inside space-y-1 ml-2 text-xs">
                                    <li>해당 기능을 이용하는 시점에 정보통신망을 통해 암호화(HTTPS/TLS) 전송됩니다.</li>
                                    <li>
                                        운행일지·예약 등 데이터베이스(Firestore)는 Google Cloud의 <strong>서울(asia-northeast3) 리전</strong>에 보관되나,
                                        운영 주체가 미국 법인이므로 국외 이전에 해당합니다.
                                    </li>
                                </ul>
                            </div>

                            <div className="space-y-2">
                                <p className="font-medium text-surface-700 dark:text-surface-300">보유 및 이용 기간</p>
                                <ul className="list-disc list-inside space-y-1 ml-2 text-xs">
                                    <li>위탁 목적 달성 시까지 보유하며, 회원 탈퇴 또는 기관 삭제 시 제9조에 따라 파기합니다.</li>
                                    <li>계기판 사진은 분석 직후, 증빙서류 사본은 승인 후 30일 경과 시 파기됩니다.</li>
                                </ul>
                            </div>

                            <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 dark:bg-blue-900/20 dark:border-blue-800">
                                <p className="font-medium text-blue-800 dark:text-blue-300 mb-2">국외 이전 거부 방법 및 절차</p>
                                <ul className="list-disc list-inside space-y-1 ml-2 text-blue-700 dark:text-blue-400 text-xs">
                                    <li>제12조의 개인정보 보호책임자 또는 서비스 내 피드백 기능으로 국외 이전 거부를 요청할 수 있습니다.</li>
                                    <li>
                                        <strong>이용하지 않으면 이전되지 않는 항목</strong> — Google Calendar·Slack 연동(기관관리자가 설정하지 않으면 발생하지 않음),
                                        AI 판독·챗봇 기능(해당 기능을 사용하지 않으면 발생하지 않음).
                                    </li>
                                    <li>
                                        <strong>개별 거부가 불가한 항목</strong> — 인증·데이터 저장(Firebase), 운영자 알림(Discord),
                                        오류 모니터링(Sentry), 안내 메일 발송(Gmail·EmailJS)은 서비스 제공과 장애 대응에 필수적입니다.
                                        거부하시는 경우 서비스 이용이 불가하며 계정 삭제로 처리됩니다.
                                    </li>
                                </ul>
                            </div>
                        </div>
                    </section>

                    {/* 제9조 */}
                    <section className="space-y-3">
                        <h2 className="text-lg font-semibold text-surface-800 dark:text-surface-200">제9조 (개인정보의 파기)</h2>
                        <div className="text-sm text-surface-600 dark:text-surface-400 leading-relaxed">
                            <ul className="list-disc list-inside space-y-1 ml-2">
                                <li>기관 삭제 시 해당 기관의 모든 사용자 정보와 데이터가 완전히 삭제됩니다.</li>
                                <li>계기판 사진은 AI 분석 직후 즉시 파기됩니다.</li>
                                <li>비영리 증빙서류(고유번호증/사업자등록증) 사본은 <strong>승인 후 30일 경과 시 자동 파기</strong>됩니다.</li>
                            </ul>
                        </div>
                    </section>

                    {/* 제10조 */}
                    <section className="space-y-3">
                        <h2 className="text-lg font-semibold text-surface-800 dark:text-surface-200">제10조 (이용자의 권리)</h2>
                        <div className="text-sm text-surface-600 dark:text-surface-400 leading-relaxed">
                            <ul className="list-disc list-inside space-y-1 ml-2">
                                <li>이용자는 자신의 개인정보 열람, 정정, 삭제를 요청할 수 있습니다.</li>
                                <li>기관관리자는 소속 직원의 정보를 관리할 수 있습니다.</li>
                                <li>개인정보 관련 문의는 서비스 내 피드백 기능 또는 제12조의 연락처로 접수할 수 있습니다.</li>
                            </ul>
                        </div>
                    </section>

                    {/* 제11조 */}
                    <section className="space-y-3">
                        <h2 className="text-lg font-semibold text-surface-800 dark:text-surface-200">제11조 (개인정보 보호 조치)</h2>
                        <div className="text-sm text-surface-600 dark:text-surface-400 leading-relaxed">
                            <ul className="list-disc list-inside space-y-1 ml-2">
                                <li>모든 데이터 전송은 HTTPS(SSL/TLS)로 암호화됩니다.</li>
                                <li>Firebase 보안 규칙을 통해 기관 간 데이터가 완전히 격리됩니다.</li>
                                <li>역할 기반 접근 제어(슈퍼관리자, 기관관리자, 직원)로 권한이 관리됩니다.</li>
                                <li>외부 연동에 사용하는 인증 토큰은 암호화하여 보관합니다.</li>
                            </ul>
                        </div>
                    </section>

                    {/* 제12조 */}
                    <section className="space-y-3">
                        <h2 className="text-lg font-semibold text-surface-800 dark:text-surface-200">제12조 (개인정보 보호책임자)</h2>
                        <div className="text-sm text-surface-600 dark:text-surface-400 leading-relaxed space-y-3">
                            <p>
                                개인정보 처리에 관한 업무를 총괄하고 이용자의 문의·불만·피해 구제를 처리하기 위하여
                                아래와 같이 개인정보 보호책임자를 지정하고 있습니다.
                            </p>

                            <div className="bg-surface-50 dark:bg-surface-800 rounded-xl p-4 space-y-1 text-xs">
                                <p><span className="text-surface-400 dark:text-surface-500">운영 주체 · </span>소셜프리즘</p>
                                <p><span className="text-surface-400 dark:text-surface-500">개인정보 보호책임자 · </span>김종원</p>
                                <p className="break-all"><span className="text-surface-400 dark:text-surface-500">연락처 · </span>ehsheh@gmail.com</p>
                            </div>

                            <p className="text-xs">
                                개인정보 침해로 인한 상담·신고는 개인정보침해신고센터(privacy.kisa.or.kr, 국번없이 118),
                                개인정보 분쟁조정위원회(kopico.go.kr, 1833-6972)에도 문의하실 수 있습니다.
                            </p>
                        </div>
                    </section>

                    <div className="border-t border-surface-100 dark:border-surface-700 pt-4 space-y-2 text-center">
                        <p className="text-xs text-surface-400 dark:text-surface-500">본 개인정보 처리방침은 2026년 8월 5일부터 시행됩니다.</p>
                        <p className="text-xs text-surface-400 dark:text-surface-500">
                            개정 이력 · 2026년 2월 1일 최초 시행 / 2026년 8월 5일 위탁·국외 이전·보호책임자 조항 신설
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}
