import { useState, useEffect } from 'react';
import { subscribeFeedbacks, updateFeedback } from '../../lib/firestore';
import { formatTimestampFull } from '../../lib/dateUtils';
import type { Feedback } from '../../types';

export default function FeedbackManagement() {
    const [feedbacks, setFeedbacks] = useState<Feedback[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [filter, setFilter] = useState<'all' | 'unread' | 'read'>('all');
    const [selectedImage, setSelectedImage] = useState<string | null>(null);

    const [expandedId, setExpandedId] = useState<string | null>(null);

    useEffect(() => {
        const unsub = subscribeFeedbacks((data) => {
            setFeedbacks(data);
            setLoading(false);
        });
        return () => unsub();
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



    const filtered = feedbacks.filter(fb => {
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
                        { key: 'all', label: '전체' },
                        { key: 'unread', label: '미확인' },
                        { key: 'read', label: '확인됨' },
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
            {filtered.length === 0 ? (
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
                    {filtered.map(fb => {
                        const isExpanded = expandedId === fb.id;
                        const isUnread = fb.status !== 'read';

                        return (
                            <div
                                key={fb.id}
                                className={`glass-card overflow-hidden transition-all hover:shadow-glass-lg ${isUnread ? 'border-l-4 border-l-primary-400' : ''
                                    }`}
                            >
                                <div
                                    className="p-4 cursor-pointer"
                                    onClick={() => setExpandedId(isExpanded ? null : fb.id)}
                                >
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 mb-1">
                                                {isUnread && (
                                                    <span className="w-2 h-2 rounded-full bg-primary-500 flex-shrink-0" />
                                                )}
                                                <span className="font-semibold text-surface-900 dark:text-surface-100 text-sm">
                                                    {fb.userName || '이름 없음'}
                                                </span>
                                                <span className="text-xs text-surface-400">
                                                    {fb.userEmail}
                                                </span>
                                            </div>
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
                                                    기관 ID: <code className="bg-surface-100 dark:bg-surface-700 px-1.5 py-0.5 rounded text-xs">{fb.organizationId}</code>
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
        </div>
    );
}
