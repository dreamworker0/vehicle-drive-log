import { useState } from 'react';
import useFeedbackManagement from '../../hooks/useFeedbackManagement';
import { formatTimestampFull } from '../../lib/dateUtils';
import type { Feedback } from '../../types';

export default function FeedbackManagement() {
    const {
        loading,
        feedbacks,
        searchQuery,
        setSearchQuery,
        filter,
        setFilter,
        selectedImage,
        setSelectedImage,
        deleteTarget,
        setDeleteTarget,
        deleting,
        orgNames,
        expandedId,
        setExpandedId,
        expandedGroups,
        copiedEmail,
        copiedMessage,
        sendingReply,
        replyError,
        handleToggleResolve,
        handleDelete,
        handleSendReply,
        regeneratingDraftId,
        handleRegenerateDraft,
        groupedFeedbacks,
        toggleGroup,
        handleCopyEmail,
        handleCopyMessage,
        totalFiltered,
        unreadCount,
        resolvedCount,
        timelineFeedbacks,
    } = useFeedbackManagement();

    // 각 의견별 답변 텍스트 편집 상태
    const [replyTexts, setReplyTexts] = useState<Record<string, string>>({});
    // 보기 모드 상태
    const [viewMode, setViewMode] = useState<'grouped' | 'timeline'>('grouped');

    const renderFeedbackItem = (fb: Feedback, showAuthorInfo = false) => {
        const isExpanded = expandedId === fb.id;
        const isResolved = fb.status === 'read' || fb.status === 'resolved';
        const isUnread = !isResolved;

        return (
            <div
                key={fb.id}
                className={`border-b border-surface-50 dark:border-surface-700/50 last:border-b-0 ${isResolved ? 'border-l-4 border-l-green-400' : isUnread ? 'border-l-4 border-l-primary-400' : ''}`}
            >
                <div
                    className="p-4 cursor-pointer hover:bg-surface-50/50 dark:hover:bg-surface-700/20 transition-colors"
                    onClick={() => setExpandedId(isExpanded ? null : fb.id)}
                >
                    <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                            {showAuthorInfo && (
                                <div className="mb-2 flex items-center gap-2 flex-wrap">
                                    <span className="font-semibold text-surface-900 dark:text-surface-100 text-sm">
                                        {fb.userName || '이름 없음'}
                                    </span>
                                    {(fb.organizationId || fb.organizationName) && (
                                        <span className="text-xs text-surface-500 dark:text-surface-400">
                                            {fb.organizationName || (fb.organizationId && orgNames[fb.organizationId]) || fb.organizationId}
                                        </span>
                                    )}
                                    {fb.userEmail && (
                                        <span className="text-xs text-surface-400 dark:text-surface-500">
                                            {fb.userEmail}
                                        </span>
                                    )}
                                </div>
                            )}
                            <p className={`text-sm text-surface-600 dark:text-surface-400 ${isExpanded ? '' : 'line-clamp-2'}`}>
                                {fb.message}
                            </p>
                            <div className="flex items-center gap-3 mt-2 text-xs text-surface-400">
                                <span>{formatTimestampFull(fb.createdAt) || '-'}</span>
                                {fb.imageUrls && fb.imageUrls.length > 0 && (
                                    <span className="flex items-center gap-1">
                                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909M3.75 21h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75a1.5 1.5 0 0 0-1.5 1.5v13.5a1.5 1.5 0 0 0 0 3z" />
                                        </svg>
                                        이미지 {fb.imageUrls?.length ?? 0}장
                                    </span>
                                )}
                            </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                            {isResolved ? (
                                <span className="px-2.5 py-1 rounded-lg text-xs font-medium bg-green-50 text-green-600 dark:bg-green-900/30 dark:text-green-300">
                                    ✅ 처리완료
                                </span>
                            ) : null}
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    handleToggleResolve(fb);
                                }}
                                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${isUnread
                                    ? 'bg-primary-50 text-primary-600 hover:bg-primary-100 dark:bg-primary-900/30 dark:text-primary-300 dark:hover:bg-primary-900/50'
                                    : 'bg-surface-100 text-surface-500 hover:bg-surface-200 dark:bg-surface-700 dark:text-surface-400 dark:hover:bg-surface-600'
                                    }`}
                                title={isUnread ? '처리완료 상태로 표시' : '미확인으로 변경'}
                            >
                                {isUnread ? '미확인' : '완료 취소'}
                            </button>
                            <button
                                onClick={(e) => handleCopyMessage(e, fb.id, fb.message || '')}
                                className="p-1.5 rounded-lg text-surface-400 hover:text-primary-500 hover:bg-primary-50 dark:hover:text-primary-400 dark:hover:bg-primary-900/30 transition-all"
                                title="본문 복사"
                            >
                                {copiedMessage === fb.id ? (
                                    <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                                    </svg>
                                ) : (
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0 0 13.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 0 1-.75.75H9a.75.75 0 0 1-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 0 1-2.25 2.25H6.75A2.25 2.25 0 0 1 4.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 0 1 1.927-.184" />
                                    </svg>
                                )}
                            </button>
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setDeleteTarget(fb);
                                }}
                                className="p-1.5 rounded-lg text-surface-400 hover:text-red-500 hover:bg-red-50 dark:hover:text-red-400 dark:hover:bg-red-900/30 transition-all"
                                title="삭제"
                            >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                                </svg>
                            </button>
                            <svg
                                className={`w-4 h-4 text-surface-400 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
                                fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"
                            >
                                <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                            </svg>
                        </div>
                    </div>
                </div>

                {/* 확장된 내용 */}
                {isExpanded && (
                    <div className="border-t border-surface-100 dark:border-surface-700 bg-surface-50/50 dark:bg-surface-800/50 p-4 animate-slide-down">
                        <div className="text-sm text-surface-700 dark:text-surface-300 whitespace-pre-wrap mb-4">
                            {fb.message}
                        </div>

                        {/* 첨부 이미지 */}
                        {fb.imageUrls && fb.imageUrls.length > 0 && (
                            <div>
                                <p className="text-xs font-medium text-surface-500 dark:text-surface-400 mb-2">첨부 이미지</p>
                                <div className="flex gap-3 flex-wrap">
                                    {fb.imageUrls?.map((url: string, idx: number) => (
                                        <button
                                            key={idx}
                                            onClick={() => setSelectedImage(url)}
                                            className="w-24 h-24 rounded-xl overflow-hidden border border-surface-200 dark:border-surface-600 hover:border-primary-300 hover:shadow-md transition-all"
                                        >
                                            <img
                                                src={url}
                                                alt={`첨부 ${idx + 1}`}
                                                className="w-full h-full object-cover"
                                            />
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* ── AI 답변 초안 + 답변 발송 영역 ── */}
                        <div className="mt-4 pt-4 border-t border-surface-200 dark:border-surface-600">
                            {fb.status === 'resolved' ? (
                                /* 답변 완료(AI 전송된 건) — 발송된 답변 표시 */
                                <div>
                                    <div className="flex items-center gap-2 mb-2">
                                        <span className="text-sm font-semibold text-green-600 dark:text-green-400">✅ 발송된 답변</span>
                                        {fb.repliedBy === 'superAdmin' && (
                                            <span className="text-xs px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-300">
                                                관리자
                                            </span>
                                        )}
                                        {fb.repliedAt && (
                                            <span className="text-xs text-surface-400">
                                                {formatTimestampFull(fb.repliedAt)}
                                            </span>
                                        )}
                                    </div>
                                    <div className="text-sm text-surface-700 dark:text-surface-300 whitespace-pre-wrap bg-green-50/50 dark:bg-green-900/10 rounded-xl p-3 border border-green-200/50 dark:border-green-800/30">
                                        {fb.reply}
                                    </div>
                                </div>
                            ) : (
                                /* 미답변 — AI 초안 + 편집 + 발송 */
                                <div>
                                    {/* AI 초안 헤더 */}
                                    <div className="flex items-center justify-between mb-2">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <span className="text-sm font-semibold text-surface-700 dark:text-surface-300">🤖 AI 답변 초안</span>
                                            {fb.aiMatchedFaqId != null || fb.aiMatchedFaqIndex != null ? (
                                                <span className="text-xs px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-300 whitespace-nowrap">
                                                    {fb.aiMatchedFaqId ? 'FAQ 매칭' : `Q${fb.aiMatchedFaqIndex} 매칭`}
                                                    {fb.aiConfidence != null && ` (${Math.round(fb.aiConfidence * 100)}%)`}
                                                </span>
                                            ) : null}
                                            {!fb.aiDraft && (() => {
                                                const createdMs = fb.createdAt
                                                    ? ('toMillis' in fb.createdAt
                                                        ? (fb.createdAt as { toMillis: () => number }).toMillis()
                                                        : 'seconds' in fb.createdAt
                                                            ? (fb.createdAt as { seconds: number }).seconds * 1000
                                                            : 0)
                                                    : 0;
                                                const elapsed = Date.now() - createdMs;
                                                const isTimeout = elapsed > 30_000;

                                                return isTimeout ? (
                                                    <span className="text-xs text-amber-500 dark:text-amber-400">
                                                        ⚠ 실패
                                                    </span>
                                                ) : (
                                                    <span className="flex items-center gap-1 text-xs text-surface-400">
                                                        <span className="w-3 h-3 spinner" /> 생성 중...
                                                    </span>
                                                );
                                            })()}
                                        </div>
                                        <button
                                            onClick={() => handleRegenerateDraft(fb.id)}
                                            disabled={regeneratingDraftId === fb.id || sendingReply === fb.id}
                                            className="flex-shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-surface-500 dark:text-surface-400 hover:text-primary-600 dark:hover:text-primary-400 bg-surface-100 dark:bg-surface-700 hover:bg-primary-50 dark:hover:bg-primary-900/30 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                            title="새로운 답변 초안 생성"
                                        >
                                            {regeneratingDraftId === fb.id ? (
                                                <>
                                                    <span className="w-3.5 h-3.5 spinner" />
                                                    <span className="hidden sm:inline">생성 중...</span>
                                                </>
                                            ) : (
                                                <>
                                                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                                                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
                                                    </svg>
                                                    <span className="hidden sm:inline">새로 생성</span>
                                                </>
                                            )}
                                        </button>
                                    </div>

                                    {/* 답변 편집 textarea */}
                                    <textarea
                                        value={replyTexts[fb.id] ?? fb.aiDraft ?? ''}
                                        onChange={(e) => setReplyTexts(prev => ({ ...prev, [fb.id]: e.target.value }))}
                                        className="w-full min-h-[200px] p-3 rounded-xl border border-surface-200 dark:border-surface-600 bg-white dark:bg-surface-700 text-sm md:text-base text-surface-700 dark:text-surface-300 resize-y focus:ring-2 focus:ring-primary-300 dark:focus:ring-primary-700 focus:border-transparent transition-all"
                                        placeholder="답변을 작성하세요..."
                                    />

                                    {/* 에러 메시지 */}
                                    {replyError && sendingReply === fb.id && (
                                        <p className="text-xs text-red-500 mt-1">{replyError}</p>
                                    )}

                                    {/* 발송 버튼 */}
                                    <div className="flex justify-end mt-2">
                                        <button
                                            onClick={() => {
                                                const text = replyTexts[fb.id] ?? fb.aiDraft ?? '';
                                                if (text.trim()) handleSendReply(fb.id, text);
                                            }}
                                            disabled={sendingReply === fb.id || !(replyTexts[fb.id] ?? fb.aiDraft ?? '').trim()}
                                            className="px-4 py-2 rounded-xl text-sm font-medium text-white bg-primary-500 hover:bg-primary-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center gap-2"
                                        >
                                            {sendingReply === fb.id ? (
                                                <>
                                                    <span className="w-4 h-4 spinner" />
                                                    발송 중...
                                                </>
                                            ) : (
                                                <>
                                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                                                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 12 3.269 3.126A59.768 59.768 0 0 1 21.485 12 59.77 59.77 0 0 1 3.27 20.876L5.999 12Zm0 0h7.5" />
                                                    </svg>
                                                    답변 발송
                                                </>
                                            )}
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        );
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <div className="w-8 h-8 spinner" />
            </div>
        );
    }

    return (
        <div className="max-w-4xl mx-auto animate-fade-in">
            <div className="mb-6">
                <h1 className="text-2xl font-bold text-surface-900 dark:text-surface-100">의견 관리</h1>
                <p className="text-sm text-surface-500 dark:text-surface-400 mt-1">
                    사용자가 보낸 의견을 확인하세요
                    {unreadCount > 0 && (
                        <span className="ml-2 badge-danger">
                            미확인 {unreadCount}건
                        </span>
                    )}
                </p>
            </div>

            {/* 필터 & 검색 */}
            <div className="flex flex-col sm:flex-row gap-3 mb-4">
                <div className="flex gap-1 bg-surface-100 dark:bg-surface-800 rounded-xl p-1">
                    {[
                        { key: 'unread', label: '미확인' },
                        { key: 'resolved', label: `처리완료${resolvedCount > 0 ? ` ${resolvedCount}` : ''}` },
                        { key: 'all', label: '전체' },
                    ].map(f => (
                        <button
                            key={f.key}
                            onClick={() => setFilter(f.key as 'all' | 'unread' | 'resolved')}
                            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${filter === f.key
                                ? 'bg-white dark:bg-surface-700 text-primary-700 dark:text-primary-300 shadow-sm'
                                : 'text-surface-500 hover:text-surface-700 dark:text-surface-400 dark:hover:text-surface-300'
                                }`}
                        >
                            {f.label}
                        </button>
                    ))}
                </div>
                
                <div className="flex gap-1 bg-surface-100 dark:bg-surface-800 rounded-xl p-1 shrink-0">
                    {[
                        { key: 'grouped', label: '사람별' },
                        { key: 'timeline', label: '시간순' },
                    ].map(v => (
                        <button
                            key={v.key}
                            onClick={() => setViewMode(v.key as 'grouped' | 'timeline')}
                            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${viewMode === v.key
                                ? 'bg-white dark:bg-surface-700 text-primary-700 dark:text-primary-300 shadow-sm'
                                : 'text-surface-500 hover:text-surface-700 dark:text-surface-400 dark:hover:text-surface-300'
                                }`}
                        >
                            {v.label}
                        </button>
                    ))}
                </div>

                <div className="relative flex-1">
                    <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
                    </svg>
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        className="input pl-10"
                        placeholder="작성자, 이메일, 내용 검색"
                    />
                </div>
            </div>

            {/* 피드백 목록 */}
            {totalFiltered === 0 ? (
                <div className="glass-card p-12 text-center">
                    <svg className="w-16 h-16 mx-auto text-surface-200 mb-4" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.076-4.076a1.526 1.526 0 0 1 1.037-.443 48.282 48.282 0 0 0 5.68-.494c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z" />
                    </svg>
                    <p className="text-surface-400 text-lg font-medium">
                        {feedbacks.length === 0 ? '받은 의견이 없습니다' : '검색 결과가 없습니다'}
                    </p>
                </div>
            ) : (
                <div className="grid gap-3">
                    {viewMode === 'timeline' ? (
                        <div className="glass-card overflow-hidden">
                            {timelineFeedbacks.map(fb => renderFeedbackItem(fb, true))}
                        </div>
                    ) : (
                        groupedFeedbacks.map(group => {
                            const isGroupOpen = expandedGroups.has(group.key);
                            const latestTime = formatTimestampFull(group.items[0]?.createdAt) || '-';

                            return (
                                <div key={group.key} className="glass-card overflow-hidden">
                                    {/* 그룹 헤더 */}
                                    <div
                                        onClick={() => toggleGroup(group.key)}
                                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') toggleGroup(group.key); }}
                                        role="button"
                                        tabIndex={0}
                                        className="w-full text-left p-4 flex items-center justify-between gap-3 hover:bg-surface-50/50 dark:hover:bg-surface-700/30 transition-colors cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                                    >
                                        <div className="flex items-center gap-3 min-w-0">
                                            <div className="w-9 h-9 rounded-full bg-primary-100 dark:bg-primary-900/40 flex items-center justify-center flex-shrink-0">
                                                <span className="text-sm font-bold text-primary-700 dark:text-primary-300">
                                                    {(group.name || '?')[0]}
                                                </span>
                                            </div>
                                            <div className="text-left min-w-0">
                                                <div className="flex items-center gap-2">
                                                    <span className="font-semibold text-surface-900 dark:text-surface-100 text-sm">
                                                        {group.name}
                                                    </span>
                                                    {group.orgName && (
                                                        <span className="text-xs text-surface-400 dark:text-surface-500">
                                                            {group.orgName}
                                                        </span>
                                                    )}
                                                    <span className="text-xs font-medium px-1.5 py-0.5 rounded-full bg-surface-200 dark:bg-surface-600 text-surface-600 dark:text-surface-300">
                                                        {group.items.length}
                                                    </span>
                                                    {group.unreadCount > 0 && (
                                                        <span className="w-2 h-2 rounded-full bg-primary-500 flex-shrink-0" />
                                                    )}
                                                </div>
                                                {group.email && (
                                                    <span className="flex items-center gap-1 min-w-0">
                                                        <span className="text-xs text-surface-400 truncate">
                                                            {group.email}
                                                        </span>
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); handleCopyEmail(e, group.email); }}
                                                            className="flex-shrink-0 p-0.5 rounded hover:bg-surface-200 dark:hover:bg-surface-600 text-surface-400 hover:text-surface-600 dark:hover:text-surface-300 transition-colors"
                                                            title="이메일 복사"
                                                        >
                                                            {copiedEmail === group.email ? (
                                                                <svg className="w-3.5 h-3.5 text-green-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                                                                    <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                                                                </svg>
                                                            ) : (
                                                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 0 1 1.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-2.234-1.233-4.154-3.05-5.16" />
                                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75" />
                                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 2.25h-3a2.25 2.25 0 0 0-2.25 2.25v.75h7.5v-.75A2.25 2.25 0 0 0 16.5 2.25Z" />
                                                                </svg>
                                                            )}
                                                        </button>
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2 flex-shrink-0">
                                            <span className="text-xs text-surface-400 hidden sm:inline">
                                                최근 {latestTime}
                                            </span>
                                            <svg
                                                className={`w-4 h-4 text-surface-400 transition-transform duration-200 ${isGroupOpen ? 'rotate-180' : ''}`}
                                                fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"
                                            >
                                                <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                                            </svg>
                                        </div>
                                    </div>

                                    {/* 그룹 내 의견 목록 */}
                                    {isGroupOpen && (
                                        <div className="border-t border-surface-100 dark:border-surface-700 animate-slide-down">
                                            {group.items.map(fb => renderFeedbackItem(fb, false))}
                                        </div>
                                    )}
                                </div>
                            );
                        })
                    )}
                </div>
            )}

            {/* 이미지 확대 모달 */}
            {selectedImage && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
                    onClick={() => setSelectedImage(null)}
                >
                    <div className="relative max-w-3xl max-h-[90vh] mx-4 animate-scale-in">
                        <button
                            onClick={() => setSelectedImage(null)}
                            className="absolute -top-3 -right-3 w-8 h-8 bg-white dark:bg-surface-800 rounded-full shadow-lg flex items-center justify-center text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:text-surface-300 transition-colors z-10"
                        >
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                            </svg>
                        </button>
                        <img
                            src={selectedImage}
                            alt="확대 이미지"
                            className="max-w-full max-h-[85vh] rounded-2xl shadow-2xl object-contain"
                            onClick={e => e.stopPropagation()}
                        />
                    </div>
                </div>
            )}

            {/* 삭제 확인 모달 */}
            {deleteTarget && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
                    onClick={() => !deleting && setDeleteTarget(null)}
                >
                    <div
                        className="bg-white dark:bg-surface-800 rounded-2xl shadow-2xl p-6 max-w-sm mx-4 animate-scale-in"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="flex items-center gap-3 mb-4">
                            <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center flex-shrink-0">
                                <svg className="w-5 h-5 text-red-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                                </svg>
                            </div>
                            <div>
                                <h3 className="font-semibold text-surface-900 dark:text-surface-100">의견 삭제</h3>
                                <p className="text-sm text-surface-500 dark:text-surface-400">
                                    <span className="font-medium">{deleteTarget.userName || '이름 없음'}</span>님의 의견을 삭제할까요?
                                </p>
                            </div>
                        </div>
                        <p className="text-xs text-surface-400 mb-5">삭제된 의견은 복구할 수 없습니다.</p>
                        <div className="flex gap-2 justify-end">
                            <button
                                onClick={() => setDeleteTarget(null)}
                                disabled={deleting}
                                className="px-4 py-2 rounded-xl text-sm font-medium text-surface-600 dark:text-surface-400 bg-surface-100 dark:bg-surface-700 hover:bg-surface-200 dark:hover:bg-surface-600 transition-colors"
                            >
                                취소
                            </button>
                            <button
                                onClick={handleDelete}
                                disabled={deleting}
                                className="px-4 py-2 rounded-xl text-sm font-medium text-white bg-red-500 hover:bg-red-600 dark:bg-red-600 dark:hover:bg-red-700 transition-colors disabled:opacity-50"
                            >
                                {deleting ? '삭제 중...' : '삭제'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
