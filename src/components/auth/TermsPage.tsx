import { useNavigate } from 'react-router-dom';

export default function TermsPage() {
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
                        <h1 className="text-2xl font-bold text-surface-900 dark:text-surface-100 mb-1">이용약관</h1>
                        <p className="text-sm text-surface-400">시행일: 2026년 2월 1일</p>
                    </div>

                    {/* 제1조 */}
                    <section className="space-y-2">
                        <h2 className="text-lg font-semibold text-surface-800 dark:text-surface-200">제1조 (목적)</h2>
                        <p className="text-sm text-surface-600 dark:text-surface-400 leading-relaxed">
                            본 약관은 차량 운행일지 서비스(이하 "서비스")의 이용 조건 및 절차, 이용자와 서비스
                            제공자의 권리·의무·책임사항을 규정함을 목적으로 합니다.
                        </p>
                    </section>

                    {/* 제2조 */}
                    <section className="space-y-2">
                        <h2 className="text-lg font-semibold text-surface-800 dark:text-surface-200">제2조 (서비스 대상)</h2>
                        <div className="text-sm text-surface-600 dark:text-surface-400 leading-relaxed space-y-2">
                            <p>본 서비스는 다음에 해당하는 기관을 대상으로 <strong>무료</strong>로 제공됩니다.</p>
                            <ul className="list-disc list-inside space-y-1 ml-2">
                                <li>사회복지기관 (사회복지법인, 사회복지시설 등)</li>
                                <li>비영리단체 (비영리법인, 비영리민간단체 등)</li>
                            </ul>
                            <p>
                                영리 목적의 일반 기업은 본 서비스의 사용 대상이 아니며,
                                신청 시 <strong>거부</strong>될 수 있습니다.
                            </p>
                        </div>
                    </section>

                    {/* 제3조 */}
                    <section className="space-y-2">
                        <h2 className="text-lg font-semibold text-surface-800 dark:text-surface-200">제3조 (서비스 내용)</h2>
                        <div className="text-sm text-surface-600 dark:text-surface-400 leading-relaxed space-y-2">
                            <p>서비스는 다음의 기능을 제공합니다.</p>
                            <ul className="list-disc list-inside space-y-1 ml-2">
                                <li>차량 운행일지 작성, 조회, 수정, 출력(PDF/Excel)</li>
                                <li>차량 예약 관리 (달력 기반)</li>
                                <li>AI 기반 계기판 OCR 인식 (주행거리 자동 추출)</li>
                                <li>AI 기반 비영리 증빙서류 검증</li>
                                <li>티맵 딥링크 연동 (내비게이션)</li>
                                <li>차량 정비/수리 기록 관리</li>
                                <li>운행 통계 보고서</li>
                            </ul>
                        </div>
                    </section>

                    {/* 제4조 */}
                    <section className="space-y-2">
                        <h2 className="text-lg font-semibold text-surface-800 dark:text-surface-200">제4조 (이용자의 의무)</h2>
                        <div className="text-sm text-surface-600 dark:text-surface-400 leading-relaxed space-y-2">
                            <ul className="list-disc list-inside space-y-1 ml-2">
                                <li>이용자는 정확한 기관 정보를 제공해야 합니다.</li>
                                <li>타인의 계정을 무단으로 사용할 수 없습니다.</li>
                                <li>서비스를 부정한 목적으로 이용할 수 없습니다.</li>
                                <li>이용자는 관련 법령과 본 약관의 규정을 준수해야 합니다.</li>
                            </ul>
                        </div>
                    </section>

                    {/* 제5조 */}
                    <section className="space-y-2">
                        <h2 className="text-lg font-semibold text-surface-800 dark:text-surface-200">제5조 (서비스의 변경 및 중단)</h2>
                        <div className="text-sm text-surface-600 dark:text-surface-400 leading-relaxed space-y-2">
                            <ul className="list-disc list-inside space-y-1 ml-2">
                                <li>서비스 제공자는 서비스의 내용을 변경하거나 일부 또는 전부를 중단할 수 있습니다.</li>
                                <li>서비스 변경 또는 중단 시 사전에 공지합니다. 다만, 긴급한 경우 사후에 공지할 수 있습니다.</li>
                                <li>무료로 제공되는 서비스의 변경·중단에 대해 별도의 보상을 하지 않습니다.</li>
                            </ul>
                        </div>
                    </section>

                    {/* 제6조 */}
                    <section className="space-y-2">
                        <h2 className="text-lg font-semibold text-surface-800 dark:text-surface-200">제6조 (면책 조항)</h2>
                        <div className="text-sm text-surface-600 dark:text-surface-400 leading-relaxed space-y-2">
                            <ul className="list-disc list-inside space-y-1 ml-2">
                                <li>
                                    서비스 제공자는 AI OCR 인식 결과의 정확성을 보장하지 않으며,
                                    이용자는 인식 결과를 반드시 확인해야 합니다.
                                </li>
                                <li>
                                    천재지변, 시스템 장애 등 불가항력으로 인한 서비스 중단에 대해
                                    책임을 지지 않습니다.
                                </li>
                                <li>
                                    이용자가 입력한 데이터의 정확성에 대한 책임은 이용자에게 있습니다.
                                </li>
                            </ul>
                        </div>
                    </section>

                    {/* 제7조 */}
                    <section className="space-y-2">
                        <h2 className="text-lg font-semibold text-surface-800 dark:text-surface-200">제7조 (기관 삭제 및 탈퇴)</h2>
                        <div className="text-sm text-surface-600 dark:text-surface-400 leading-relaxed space-y-2">
                            <ul className="list-disc list-inside space-y-1 ml-2">
                                <li>
                                    기관 관리자는 서비스 관리자에게 기관 삭제를 요청할 수 있으며,
                                    삭제 시 해당 기관의 모든 데이터(운행일지, 차량, 예약 등)가 삭제됩니다.
                                </li>
                                <li>
                                    기관 삭제 시 소속 직원의 계정도 함께 삭제되며, 즉시 접근이 차단됩니다.
                                </li>
                            </ul>
                        </div>
                    </section>

                    {/* 제8조 */}
                    <section className="space-y-2">
                        <h2 className="text-lg font-semibold text-surface-800 dark:text-surface-200">제8조 (약관의 변경)</h2>
                        <p className="text-sm text-surface-600 dark:text-surface-400 leading-relaxed">
                            본 약관은 필요 시 변경될 수 있으며, 변경 사항은 서비스 내 공지를 통해 안내합니다.
                            변경된 약관에 동의하지 않는 경우 서비스 이용을 중단할 수 있습니다.
                        </p>
                    </section>

                    <div className="border-t border-surface-100 dark:border-surface-700 pt-4 text-center">
                        <p className="text-xs text-surface-400">본 약관은 2026년 2월 1일부터 시행됩니다.</p>
                    </div>
                </div>
            </div>
        </div>
    );
}
