import { useState, useEffect, useMemo } from 'react';
import { subscribeFeedbacks, updateFeedback, deleteFeedback, getOrganization } from '../../lib/firestore';
import { formatTimestampFull } from '../../lib/dateUtils';
import type { Feedback } from '../../types';

export default function FeedbackManagement() {
    const [feedbacks, setFeedbacks] = useState<Feedback[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [filter, setFilter] = useState<'all' | 'unread' | 'read'>('unread');
    const [selectedImage, setSelectedImage] = useState<string | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<Feedback | null>(null);
    const [deleting, setDeleting] = useState(false);
    const [orgNames, setOrgNames] = useState<Record<string, string>>({});

    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
    const [copiedEmail, setCopiedEmail] = useState<string | null>(null);
    const [copiedMessage, setCopiedMessage] = useState<string | null>(null);

    useEffect(() => {
        const unsub = subscribeFeedbacks((data) => {
            setFeedbacks(data as Feedback[]);
            setLoading(false);

            // 고유 organizationId 수집 → 기관명 조회
            const orgIds = [...new Set(data.map(fb => fb.organizationId).filter(Boolean))] as string[];
            const newIds = orgIds.filter(id => !orgNames[id]);
            if (newIds.length > 0) {
                Promise.all(newIds.map(async id => {
                    const org = await getOrganization(id);
                    return [id, (org as Record<string, unknown>)?.name as string || id] as [string, string];
                })).then(entries => {
                    setOrgNames(prev => ({ ...prev, ...Object.fromEntries(entries) }));
                });
            }
        });
        return () => unsub();
        // eslint-disable-next-line react-hooks/exhaustive-deps -- 초기 마운트 시 1회만 구독, orgNames 변화로 재구독하면 안 됨
    }, []);

    const handleToggleRead = async (fb: Feedback) => {
        const newStatus = fb.status === 'read' ? 'unread' : 'read';
        try {
            await updateFeedback(fb.id, { status: newStatus });
            setFeedbacks(prev =>
                prev.map(f => f.id === fb.id ? { ...f, status: newStatus } : f)
            );
        } catch (err) {
            console.error('상태 변경 실패:', err);
        }
    };

    const handleDelete = async () => {
        if (!deleteTarget) return;
        setDeleting(true);
        try {
            await deleteFeedback(deleteTarget.id);
            setFeedbacks(prev => prev.filter(f => f.id !== deleteTarget.id));
        } catch (err) {
            console.error('삭제 실패:', err);
        } finally {
            setDeleting(false);
            setDeleteTarget(null);
        }
    };


    // 필터링
    const filteredRaw = feedbacks.filter(fb => {
        // 상태 필터
        if (filter === 'unread' && fb.status === 'read') return false;
        if (filter === 'read' && fb.status !== 'read') return false;

        // 검색
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase();
            return (
                fb.userName?.toLowerCase().includes(q) ||
                fb.userEmail?.toLowerCase().includes(q) ||
                fb.message?.toLowerCase().includes(q)
            );
        }
        return true;
    });

    // 정렬: 1차 최신순 → 2차 사람별 그룹
    const getTime = (fb: Feedback) => {
        const t = fb.createdAt;
        if (!t) return 0;
        if ('toMillis' in t) return (t as { toMillis: () => number }).toMillis();
        if ('seconds' in t) return (t as { seconds: number }).seconds * 1000;
        return 0;
    };

    const groupedFeedbacks = useMemo(() => {
        // 사람별 그룹핑 (이메일 기준)
        const groups = new Map<string, { key: string; name: string; email: string; items: Feedback[]; unreadCount: number }>();
        for (const fb of filteredRaw) {
            const key = fb.userEmail || fb.userName || fb.id;
            if (!groups.has(key)) {
                groups.set(key, {
                    key,
                    name: fb.userName || '이름 없음',
                    email: fb.userEmail || '',
                    items: [],
                    unreadCount: 0,
                });
            }
            const group = groups.get(key)!;
            group.items.push(fb);
            if (fb.status !== 'read') group.unreadCount++;
        }

        // 각 그룹 내 최신순 정렬
        for (const group of groups.values()) {
            group.items.sort((a, b) => getTime(b) - getTime(a));
        }

        // 그룹 간 정렬: 각 그룹의 최신 의견 시간 기준 내림차순
        return [...groups.values()].sort(
            (a, b) => getTime(b.items[0]) - getTime(a.items[0])
        );
    }, [filteredRaw]);

    const toggleGroup = (key: string) => {
        setExpandedGroups(prev => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    };

    const handleCopyEmail = async (e: React.MouseEvent, email: string) => {
        e.stopPropagation();
        try {
            await navigator.clipboard.writeText(email);
            setCopiedEmail(email);
            setTimeout(() => setCopiedEmail(null), 1500);
        } catch (err) {
            console.error('클립보드 복사 실패:', err);
        }
    };

    const handleCopyMessage = async (e: React.MouseEvent, fbId: string, message: string) => {
        e.stopPropagation();
        try {
            await navigator.clipboard.writeText(message);
            setCopiedMessage(fbId);
            setTimeout(() => setCopiedMessage(null), 1500);
        } catch (err) {
            console.error('본문 복사 실패:', err);
        }
    };

    const totalFiltered = groupedFeedbacks.reduce((sum, g) => sum + g.items.length, 0);

    const unreadCount = feedbacks.filter(f => f.status !== 'read').length;

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
                        { key: 'read', label: '확인됨' },
                        { key: 'all', label: '전체' },
                    ].map(f => (
                        <button
                            key={f.key}
                            onClick={() => setFilter(f.key as 'all' | 'unread' | 'read')}
                            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${filter === f.key
                                ? 'bg-white dark:bg-surface-700 text-primary-700 dark:text-primary-300 shadow-sm'
                                : 'text-surface-500 hover:text-surface-700 dark:text-surface-400 dark:hover:text-surface-300'
                                }`}
                        >
                            {f.label}
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
                    {groupedFeedbacks.map(group => {
                        const isGroupOpen = expandedGroups.has(group.key);
                        const latestTime = formatTimestampFull(group.items[0]?.createdAt) || '-';

                        return (
                            <div key={group.key} className="glass-card overflow-hidden">
                                {/* 그룹 헤더 */}
                                <button
                                    onClick={() => toggleGroup(group.key)}
                                    className="w-full p-4 flex items-center justify-between gap-3 hover:bg-surface-50/50 dark:hover:bg-surface-700/30 transition-colors"
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
                                                        onClick={(e) => handleCopyEmail(e, group.email)}
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
                                </button>

                                {/* 그룹 내 의견 목록 */}
                                {isGroupOpen && (
                                    <div className="border-t border-surface-100 dark:border-surface-700 animate-slide-down">
                                        {group.items.map(fb => {
                                            const isExpanded = expandedId === fb.id;
                                            const isUnread = fb.status !== 'read';

                                            return (
                                                <div
                                                    key={fb.id}
                                                    className={`border-b border-surface-50 dark:border-surface-700/50 last:border-b-0 ${isUnread ? 'border-l-4 border-l-primary-400' : ''}`}
                                                >
                                                    <div
                                                        className="p-4 cursor-pointer hover:bg-surface-50/50 dark:hover:bg-surface-700/20 transition-colors"
                                                        onClick={() => setExpandedId(isExpanded ? null : fb.id)}
                                                    >
                                                        <div className="flex items-start justify-between gap-3">
                                                            <div className="flex-1 min-w-0">
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
                                                                <button
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        handleToggleRead(fb);
                                                                    }}
                                                                    className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${isUnread
                                                                        ? 'bg-primary-50 text-primary-600 hover:bg-primary-100 dark:bg-primary-900/30 dark:text-primary-300 dark:hover:bg-primary-900/50'
                                                                        : 'bg-surface-100 text-surface-500 hover:bg-surface-200 dark:bg-surface-700 dark:text-surface-400 dark:hover:bg-surface-600'
                                                                        }`}
                                                                    title={isUnread ? '확인 처리' : '미확인으로 변경'}
                                                                >
                                                                    {isUnread ? '확인' : '확인됨'}
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
                                                                        {fb.imageUrls?.map((url, idx) => (
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

                                                            {/* 메타 정보 */}
                                                            {fb.organizationId && (
                                                                <div className="mt-3 pt-3 border-t border-surface-200 dark:border-surface-600">
                                                                    <span className="text-xs text-surface-400">
                                                                        기관: <code className="bg-surface-100 dark:bg-surface-700 px-1.5 py-0.5 rounded text-xs">{orgNames[fb.organizationId] || fb.organizationId}</code>
                                                                    </span>
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        );
                    })}
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
                                className="px-4 py-2 rounded-xl text-sm font-medium text-white bg-red-500 hover:bg-red-600 transition-colors disabled:opacity-50"
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
