import { useNavigate } from 'react-router-dom';
import SEOHead from '../common/SEOHead';
import useForceLightMode from '../../hooks/useForceLightMode';

export default function TermsPage() {
    const navigate = useNavigate();
    // 다른 공개 페이지와 동일하게 강제 라이트 (배경에 dark 변형이 없어 다크가 남으면 대비가 깨진다)
    useForceLightMode();

    return (
        <div className="min-h-screen bg-gradient-to-br from-surface-50 to-primary-50 py-8 px-4">
            <SEOHead
                title="이용약관"
                description="차량 운행일지 서비스 이용약관입니다."
                path="/terms"
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
                        <h1 className="text-2xl font-bold text-surface-900 dark:text-surface-100 mb-1">이용약관</h1>
                        <p className="text-sm text-surface-400 dark:text-surface-500">시행일: 2026년 8월 5일 (최초 시행: 2026년 2월 1일)</p>
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

                    {/*
                      제9조 — 개인정보 보호법 제26조 제1항이 위탁 시 문서에 포함하도록 정한 항목을
                      전부 담는다(목적 외 처리 금지 / 기술적·관리적 보호조치 / 목적과 범위 /
                      재위탁 제한 / 접근 제한 등 안전성 확보조치 / 관리 현황 점검 등 감독 /
                      손해배상 책임). 항목을 덜어내면 위탁 계약의 법정 요건을 잃는다.
                      수탁자 목록·국외 이전은 처리방침 제7조·제8조가 단일 원본이므로 여기서 중복하지 않는다.
                    */}
                    <section className="space-y-2">
                        <h2 className="text-lg font-semibold text-surface-800 dark:text-surface-200">제9조 (개인정보 처리의 위탁)</h2>
                        <div className="text-sm text-surface-600 dark:text-surface-400 leading-relaxed space-y-3">
                            <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 dark:bg-blue-900/20 dark:border-blue-800">
                                <p className="font-medium text-blue-800 dark:text-blue-300 mb-2">🏢 개인정보처리자는 기관입니다</p>
                                <p className="text-blue-700 dark:text-blue-400 text-xs">
                                    서비스를 이용하는 <strong>기관이 소속 직원 개인정보의 개인정보처리자(위탁자)</strong>이며,
                                    서비스 제공자는 기관의 위탁을 받아 개인정보를 처리하는 <strong>수탁자</strong>입니다.
                                    기관은 서비스 이용 신청으로써 본 조에 따라 개인정보 처리업무를 서비스 제공자에게 위탁합니다.
                                </p>
                            </div>

                            <div className="space-y-2">
                                <p className="font-medium text-surface-700 dark:text-surface-300">① 위탁업무의 목적 및 범위</p>
                                <ul className="list-disc list-inside space-y-1 ml-2 text-xs">
                                    <li>제3조의 서비스 기능 제공 (운행일지·차량·예약·정비 기록의 저장·조회·출력, 통계 산출, 알림 발송)</li>
                                    <li>이용자 인증 및 역할 기반 접근 권한 관리</li>
                                    <li>서비스의 운영·유지보수, 장애 대응 및 문의 처리</li>
                                    <li>서비스 개선을 위한 이용 현황 분석</li>
                                    <li>위탁 대상 개인정보 항목은 개인정보 처리방침 제1조에 따릅니다.</li>
                                </ul>
                            </div>

                            <div className="space-y-2">
                                <p className="font-medium text-surface-700 dark:text-surface-300">② 목적 외 처리 금지</p>
                                <p className="text-xs">
                                    서비스 제공자는 위탁받은 개인정보를 제1항의 목적 범위를 넘어 이용하거나 제3자에게 제공하지 않습니다.
                                    법령에 의한 요청이 있는 경우에만 관련 법률에 따라 제공될 수 있습니다.
                                </p>
                            </div>

                            <div className="space-y-2">
                                <p className="font-medium text-surface-700 dark:text-surface-300">③ 기술적·관리적 보호조치 및 접근 제한</p>
                                <p className="text-xs">
                                    서비스 제공자는 개인정보 처리방침 제11조에 정한 보호조치를 이행합니다.
                                    기관별 데이터는 보안 규칙으로 격리되며, 개인정보에 접근할 수 있는 권한은
                                    업무 수행에 필요한 최소한의 범위로 제한합니다.
                                </p>
                            </div>

                            <div className="space-y-2">
                                <p className="font-medium text-surface-700 dark:text-surface-300">④ 재위탁 제한</p>
                                <p className="text-xs">
                                    서비스 제공자는 기관의 동의 없이 위탁업무를 제3자에게 다시 위탁하지 않습니다.
                                    서비스 제공에 필수적인 재위탁은 개인정보 처리방침 제7조에 공개된 범위로 한정하며,
                                    변경 시 처리방침을 통해 지체 없이 공개합니다.
                                </p>
                            </div>

                            <div className="space-y-2">
                                <p className="font-medium text-surface-700 dark:text-surface-300">⑤ 관리 현황 점검 등 감독</p>
                                <ul className="list-disc list-inside space-y-1 ml-2 text-xs">
                                    <li>기관은 서비스 제공자의 개인정보 처리 현황을 점검할 수 있으며, 서비스 제공자는 이에 성실히 협조합니다.</li>
                                    <li>서비스 제공자는 기관의 요청 시 위탁업무와 관련한 개인정보 처리 현황을 제공합니다.</li>
                                    <li>기관은 소속 직원의 서비스 내 접근 권한을 직접 부여·변경·말소할 수 있습니다.</li>
                                </ul>
                            </div>

                            <div className="space-y-2">
                                <p className="font-medium text-surface-700 dark:text-surface-300">⑥ 손해배상 책임</p>
                                <p className="text-xs">
                                    서비스 제공자가 본 조의 의무를 위반하여 개인정보가 분실·도난·유출·위조·변조 또는 훼손되어
                                    기관 또는 정보주체에게 손해가 발생한 경우, 서비스 제공자는 그 범위에서 책임을 부담합니다.
                                    다만 제6조(면책 조항)에 해당하는 사유로 인한 손해는 제외합니다.
                                </p>
                            </div>

                            <div className="space-y-2">
                                <p className="font-medium text-surface-700 dark:text-surface-300">⑦ 기관(위탁자)의 의무</p>
                                <ul className="list-disc list-inside space-y-1 ml-2 text-xs">
                                    <li>기관은 소속 직원에게 개인정보의 수집·이용 및 본 위탁 사실을 고지할 책임이 있습니다.</li>
                                    <li>
                                        소속 직원의 개인정보 열람·정정·삭제 요구는 개인정보처리자인 기관이 처리하며,
                                        서비스 제공자는 처리에 필요한 기술적 협조를 제공합니다.
                                    </li>
                                    <li>
                                        개인정보 유출이 확인된 경우 정보주체 통지 및 관계 기관 신고는 기관이 수행하며,
                                        서비스 제공자는 유출 사실을 인지한 즉시 기관에 통지하고 필요한 자료를 제공합니다.
                                    </li>
                                    <li>운행일지의 탑승자란에 서비스 이용자(클라이언트)의 이름을 기록하지 않아야 합니다.</li>
                                </ul>
                            </div>
                        </div>
                    </section>

                    <div className="border-t border-surface-100 dark:border-surface-700 pt-4 space-y-2 text-center">
                        <p className="text-xs text-surface-400 dark:text-surface-500">본 약관은 2026년 8월 5일부터 시행됩니다.</p>
                        <p className="text-xs text-surface-400 dark:text-surface-500">
                            개정 이력 · 2026년 2월 1일 최초 시행 / 2026년 8월 5일 개인정보 처리의 위탁 조항 신설
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}
