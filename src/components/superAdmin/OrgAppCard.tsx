/**
 * OrgAppCard — 기관 신청 카드 컴포넌트
 * OrgApplicationList에서 추출된 서브 컴포넌트
 */
import type { Organization } from '../../types';

interface OrgAppCardProps {
    app: Organization;
    tab: 'pending' | 'rejected';
    actionLoading: Record<string, string | null>;
    selectedApp: string | null;
    onApprove: (app: Organization) => void;
    onReject: (app: Organization) => void;
    onDelete: (app: Organization) => void;
    onMoveToPending: (app: Organization) => void;
    onAiReanalyze: (app: Organization) => void;
    onToggleImage: (id: string) => void;
}

export default function OrgAppCard({
    app,
    tab,
    actionLoading,
    selectedApp,
    onApprove,
    onReject,
    onDelete,
    onMoveToPending,
    onAiReanalyze,
    onToggleImage,
}: OrgAppCardProps) {
    return (
        <div className="glass-card p-5 hover:shadow-glass-lg transition-shadow">
            <div className="flex flex-col md:flex-row md:items-start gap-4">
                <div className="flex-1 space-y-3">
                    {/* 기관명 + 상태 배지 */}
                    <div className="flex items-center gap-3 flex-wrap">
                        <h3 className="text-lg font-semibold text-surface-900 dark:text-surface-100">{app.name}</h3>
                        {tab === 'rejected' && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400">
                                거절됨
                            </span>
                        )}
                        {tab === 'pending' && (
                            app.aiVerified ? (
                                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-700">
                                    ✅ AI 자동 승인
                                </span>
                            ) : app.aiVerifyDetail ? (
                                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-700">
                                    ❌ AI: 거절 추천
                                </span>
                            ) : (
                                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-surface-100 text-surface-500 dark:text-surface-400 border border-surface-200 dark:border-surface-600">
                                    🔍 AI 분석 필요
                                </span>
                            )
                        )}
                        {tab === 'rejected' && app.aiVerifyDetail?.rejected && (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-700">
                                🤖 AI 자동 거부
                            </span>
                        )}
                    </div>

                    {/* 기관 상세 정보 */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                        <div>
                            <span className="text-surface-400">신청자:</span>
                            <span className="ml-2 text-surface-700 dark:text-surface-300 font-medium">{app.applicantName}</span>
                        </div>
                        <div>
                            <span className="text-surface-400">이메일:</span>
                            <span className="ml-2 text-surface-700 dark:text-surface-300">{app.applicantEmail}</span>
                        </div>
                        {app.uniqueNumber && (
                            <div>
                                <span className="text-surface-400">고유번호:</span>
                                <span className="ml-2 text-surface-700 dark:text-surface-300 font-mono">{app.uniqueNumber}</span>
                            </div>
                        )}
                        <div>
                            <span className="text-surface-400">전화번호:</span>
                            <span className="ml-2 text-surface-700 dark:text-surface-300">{app.applicantPhone || '-'}</span>
                        </div>
                        {app.address && (
                            <div className="sm:col-span-2 flex items-center gap-1.5">
                                <span className="text-surface-400">주소:</span>
                                <span className="ml-2 text-surface-700 dark:text-surface-300">{app.address}</span>
                                <a
                                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(app.address)}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-0.5 ml-1 px-1.5 py-0.5 rounded text-xs font-medium text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/20 transition-colors"
                                    title="구글 지도에서 보기"
                                >
                                    📍 지도
                                </a>
                            </div>
                        )}
                        {tab === 'rejected' && app.rejectedAt && (
                            <div className="sm:col-span-2">
                                <span className="text-surface-400">거절일:</span>
                                <span className="ml-2 text-surface-700 dark:text-surface-300">
                                    {typeof (app.rejectedAt as unknown as { toDate?: () => Date })?.toDate === 'function' ? (app.rejectedAt as unknown as { toDate: () => Date }).toDate().toLocaleDateString('ko-KR') : new Date(app.rejectedAt as unknown as string).toLocaleDateString('ko-KR')}
                                </span>
                            </div>
                        )}
                        {app.createdAt && (
                            <div className="sm:col-span-2">
                                <span className="text-surface-400">신청일시:</span>
                                <span className="ml-2 text-surface-700 dark:text-surface-300">
                                    {typeof (app.createdAt as unknown as { toDate?: () => Date })?.toDate === 'function'
                                        ? (app.createdAt as unknown as { toDate: () => Date }).toDate().toLocaleString('ko-KR', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                                        : new Date(app.createdAt as unknown as string).toLocaleString('ko-KR', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                </span>
                            </div>
                        )}
                    </div>

                    {/* 하고 싶은 말 */}
                    {app.message && (
                        <div className="mt-2 px-3 py-2 rounded-lg bg-primary-50 dark:bg-primary-900/20 border border-primary-100 dark:border-primary-800 text-sm">
                            <span className="text-xs font-medium text-primary-500 dark:text-primary-400">💬 하고 싶은 말</span>
                            <p className="text-surface-700 dark:text-surface-300 mt-0.5 whitespace-pre-wrap">{app.message}</p>
                        </div>
                    )}

                    {/* 고유번호증 사본 토글 */}
                    {app.uniqueNumberImageUrl && (
                        <div>
                            <button
                                onClick={() => onToggleImage(app.id)}
                                className="text-sm text-primary-600 hover:text-primary-700 font-medium"
                            >
                                {selectedApp === app.id ? '사본 닫기 ▲' : '증빙서류 사본 보기 ▼'}
                            </button>
                            {selectedApp === app.id && (
                                (() => {
                                    const url = app.uniqueNumberImageUrl || '';
                                    const isPdf = /\.pdf($|\?)/i.test(url) || url.includes('%2F') && url.toLowerCase().includes('.pdf');
                                    if (isPdf) {
                                        return (
                                            <a
                                                href={url}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="mt-2 inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300 border border-primary-200 dark:border-primary-700 hover:bg-primary-100 dark:hover:bg-primary-900/30 transition-colors text-sm font-medium animate-slide-down"
                                            >
                                                📄 PDF 증빙서류 보기 (새 창)
                                            </a>
                                        );
                                    }
                                    return (
                                        <img
                                            src={url}
                                            alt="증빙서류"
                                            className="mt-2 max-w-md rounded-lg border border-surface-200 dark:border-surface-600 animate-slide-down"
                                        />
                                    );
                                })()
                            )}
                        </div>
                    )}

                    {/* AI 분석 미완료 시 분석 버튼 */}
                    {!app.aiVerifyDetail && app.uniqueNumberImageUrl && (
                        <div className="mt-2">
                            <button
                                type="button"
                                onClick={() => onAiReanalyze(app)}
                                disabled={!!actionLoading[app.id]}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300 border border-primary-200 dark:border-primary-700 hover:bg-primary-100 dark:hover:bg-primary-900/30 transition-all disabled:opacity-50"
                            >
                                {actionLoading[app.id] === 'ai' ? (
                                    <><div className="w-3.5 h-3.5 spinner" /> AI 분석 중...</>
                                ) : (
                                    <>🤖 AI 분석 실행</>
                                )}
                            </button>
                        </div>
                    )}

                    {/* AI 검증 상세 결과 */}
                    {app.aiVerifyDetail && (
                        <div className="mt-3 p-3 rounded-lg bg-surface-50 dark:bg-surface-800 border border-surface-100 dark:border-surface-700 space-y-1.5">
                            <div className="flex items-center justify-between">
                                <p className="text-xs font-semibold text-surface-500 dark:text-surface-400 uppercase tracking-wider">AI 검증 결과</p>
                                <button
                                    type="button"
                                    onClick={() => onAiReanalyze(app)}
                                    disabled={!!actionLoading[app.id]}
                                    className="text-xs text-primary-500 hover:text-primary-700 font-medium"
                                >
                                    {actionLoading[app.id] === 'ai' ? '분석 중...' : '재분석'}
                                </button>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-sm">
                                <div className="flex items-center gap-1.5">
                                    <span className={`w-2 h-2 rounded-full ${app.aiVerifyDetail.documentType === '고유번호증' || app.aiVerifyDetail.documentType === '사업자등록증(비영리)' ? 'bg-green-500' : 'bg-red-500'}`} />
                                    <span className="text-surface-400">문서 유형:</span>
                                    <span className={`font-medium ${app.aiVerifyDetail.documentType === '고유번호증' || app.aiVerifyDetail.documentType === '사업자등록증(비영리)' ? 'text-green-700' : 'text-red-700'}`}>
                                        {app.aiVerifyDetail.documentType || '확인 불가'}
                                    </span>
                                </div>
                                {app.aiVerifyDetail.extractedName && (
                                    <div className="flex items-center gap-1.5">
                                        <span className={`w-2 h-2 rounded-full ${app.aiVerifyDetail.nameMatch ? 'bg-green-500' : 'bg-red-500'}`} />
                                        <span className="text-surface-400">추출 기관명:</span>
                                        <span className={`font-medium ${app.aiVerifyDetail.nameMatch ? 'text-green-700' : 'text-red-700'}`}>
                                            {app.aiVerifyDetail.extractedName}
                                            {app.aiVerifyDetail.nameMatch ? ' ✓' : ' ✗'}
                                        </span>
                                    </div>
                                )}
                                {app.aiVerifyDetail.uniqueNumber && (
                                    <div className="flex items-center gap-1.5">
                                        <span className="w-2 h-2 rounded-full bg-green-500" />
                                        <span className="text-surface-400">{app.aiVerifyDetail.documentType === '고유번호증' ? '고유번호:' : '사업자번호:'}</span>
                                        <span className="font-mono text-surface-700 dark:text-surface-300">{app.aiVerifyDetail.uniqueNumber}</span>
                                    </div>
                                )}
                                {app.aiVerifyDetail.address && (
                                    <div className="flex items-center gap-1.5 sm:col-span-2">
                                        <span className="w-2 h-2 rounded-full bg-green-500" />
                                        <span className="text-surface-400">주소:</span>
                                        <span className="text-surface-700 dark:text-surface-300">{app.aiVerifyDetail.address}</span>
                                        <a
                                            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(app.aiVerifyDetail.address)}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="inline-flex items-center gap-0.5 ml-1 px-1.5 py-0.5 rounded text-xs font-medium text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/20 transition-colors"
                                            title="구글 지도에서 보기"
                                        >
                                            📍 지도
                                        </a>
                                    </div>
                                )}
                                {app.aiVerifyDetail.rejected && app.aiVerifyDetail.reason && (
                                    <div className="sm:col-span-2 mt-1 px-2.5 py-1.5 rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 text-xs text-red-700 dark:text-red-300">
                                        ⚠️ <span className="font-semibold">거절 사유:</span> {app.aiVerifyDetail.reason}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>

                {/* 액션 버튼 */}
                {tab === 'pending' && (
                    <div className="flex md:flex-col gap-2">
                        <button
                            onClick={() => onApprove(app)}
                            disabled={!!actionLoading[app.id]}
                            className="btn-success btn-sm flex-1 md:flex-none"
                        >
                            {actionLoading[app.id] === 'approve' ? (
                                <div className="w-4 h-4 spinner" />
                            ) : '승인'}
                        </button>
                        <button
                            onClick={() => onReject(app)}
                            disabled={!!actionLoading[app.id]}
                            className="btn-danger btn-sm flex-1 md:flex-none"
                        >
                            {actionLoading[app.id] === 'reject' ? (
                                <div className="w-4 h-4 spinner" />
                            ) : '거절'}
                        </button>
                    </div>
                )}

                {tab === 'rejected' && (
                    <div className="flex md:flex-col gap-2">
                        <button
                            onClick={() => onMoveToPending(app)}
                            disabled={!!actionLoading[app.id]}
                            className="btn-sm text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20 border border-amber-200 dark:border-amber-700 hover:border-amber-300 dark:hover:border-amber-600 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors"
                        >
                            {actionLoading[app.id] === 'moveToPending' ? (
                                <div className="w-4 h-4 spinner" />
                            ) : '대기중으로'}
                        </button>
                        <button
                            onClick={() => onDelete(app)}
                            disabled={!!actionLoading[app.id]}
                            className="btn-sm text-surface-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 border border-surface-200 dark:border-surface-600 hover:border-red-200 dark:hover:border-red-700 rounded-lg px-3 py-1.5 text-sm transition-colors"
                        >
                            {actionLoading[app.id] === 'delete' ? (
                                <div className="w-4 h-4 spinner" />
                            ) : '제거'}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
