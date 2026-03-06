import { useNavigate } from 'react-router-dom';

export default function PrivacyPage() {
    const navigate = useNavigate();

    return (
        <div className="min-h-screen bg-gradient-to-br from-surface-50 to-primary-50 py-8 px-4">
            <div className="w-full max-w-2xl mx-auto animate-fade-in">
                {/* 뒤로가기 */}
                <button
                    onClick={() => navigate(-1)}
                    className="flex items-center gap-1.5 text-sm text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:text-surface-300 mb-6 transition-colors"
                >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
                    </svg>
                    돌아가기
                </button>

                <div className="bg-white dark:bg-surface-800 rounded-2xl shadow-soft p-6 md:p-8 space-y-8">
                    <div className="text-center border-b border-surface-100 dark:border-surface-700 pb-6">
                        <h1 className="text-2xl font-bold text-surface-900 dark:text-surface-100 mb-1">개인정보 처리방침</h1>
                        <p className="text-sm text-surface-400">시행일: 2026년 2월 1일</p>
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
                                    <li>업로드된 사본은 Firebase Storage에 암호화되어 저장됩니다.</li>
                                </ul>
                            </div>
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
                        <p className="text-sm text-surface-600 dark:text-surface-400 leading-relaxed">
                            서비스는 이용자의 개인정보를 제3자에게 제공하지 않습니다.
                            다만, 법령에 의한 요청이 있는 경우 관련 법률에 따라 제공될 수 있습니다.
                        </p>
                    </section>

                    {/* 제7조 */}
                    <section className="space-y-3">
                        <h2 className="text-lg font-semibold text-surface-800 dark:text-surface-200">제7조 (개인정보의 파기)</h2>
                        <div className="text-sm text-surface-600 dark:text-surface-400 leading-relaxed">
                            <ul className="list-disc list-inside space-y-1 ml-2">
                                <li>기관 삭제 시 해당 기관의 모든 사용자 정보와 데이터가 완전히 삭제됩니다.</li>
                                <li>계기판 사진은 AI 분석 직후 즉시 파기됩니다.</li>
                            </ul>
                        </div>
                    </section>

                    {/* 제8조 */}
                    <section className="space-y-3">
                        <h2 className="text-lg font-semibold text-surface-800 dark:text-surface-200">제8조 (이용자의 권리)</h2>
                        <div className="text-sm text-surface-600 dark:text-surface-400 leading-relaxed">
                            <ul className="list-disc list-inside space-y-1 ml-2">
                                <li>이용자는 자신의 개인정보 열람, 정정, 삭제를 요청할 수 있습니다.</li>
                                <li>기관관리자는 소속 직원의 정보를 관리할 수 있습니다.</li>
                                <li>개인정보 관련 문의는 서비스 내 피드백 기능을 통해 접수할 수 있습니다.</li>
                            </ul>
                        </div>
                    </section>

                    {/* 제9조 */}
                    <section className="space-y-3">
                        <h2 className="text-lg font-semibold text-surface-800 dark:text-surface-200">제9조 (개인정보 보호 조치)</h2>
                        <div className="text-sm text-surface-600 dark:text-surface-400 leading-relaxed">
                            <ul className="list-disc list-inside space-y-1 ml-2">
                                <li>모든 데이터 전송은 HTTPS(SSL/TLS)로 암호화됩니다.</li>
                                <li>Firebase 보안 규칙을 통해 기관 간 데이터가 완전히 격리됩니다.</li>
                                <li>역할 기반 접근 제어(슈퍼관리자, 기관관리자, 직원)로 권한이 관리됩니다.</li>
                            </ul>
                        </div>
                    </section>

                    <div className="border-t border-surface-100 dark:border-surface-700 pt-4 text-center">
                        <p className="text-xs text-surface-400">본 개인정보 처리방침은 2026년 2월 1일부터 시행됩니다.</p>
                    </div>
                </div>
            </div>
        </div>
    );
}
