import { useState, useEffect, useMemo, useCallback } from 'react';
import { getAllFeedbacks, updateFeedback, deleteFeedback, getOrganization } from '../lib/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import type { Feedback } from '../types';
import { useToast } from './useToast';

function getTime(fb: Feedback) {
    const t = fb.createdAt;
    if (!t) return 0;
    if ('toMillis' in t) return (t as { toMillis: () => number }).toMillis();
    if ('seconds' in t) return (t as { seconds: number }).seconds * 1000;
    return 0;
}

export default function useFeedbackManagement() {
    const { showToast } = useToast();
    const [feedbacks, setFeedbacks] = useState<Feedback[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [filter, setFilter] = useState<'all' | 'unread' | 'resolved'>('unread');
    const [selectedImage, setSelectedImage] = useState<string | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<Feedback | null>(null);
    const [deleting, setDeleting] = useState(false);
    const [orgNames, setOrgNames] = useState<Record<string, string>>({});

    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
    const [copiedEmail, setCopiedEmail] = useState<string | null>(null);
    const [copiedMessage, setCopiedMessage] = useState<string | null>(null);
    const [sendingReply, setSendingReply] = useState<string | null>(null);
    const [replyError, setReplyError] = useState<string | null>(null);
    const [regeneratingDraftId, setRegeneratingDraftId] = useState<string | null>(null);

    useEffect(() => {
        let isMounted = true;
        getAllFeedbacks(300).then((data) => {
            if (!isMounted) return;
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
                    if (isMounted) {
                        setOrgNames(prev => ({ ...prev, ...Object.fromEntries(entries) }));
                    }
                });
            }
        }).catch(err => {
            console.error(err);
            if (isMounted) setLoading(false);
        });

        return () => { isMounted = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleToggleResolve = useCallback(async (fb: Feedback) => {
        const newStatus = (fb.status === 'read' || fb.status === 'resolved') ? 'unread' : 'resolved';
        try {
            await updateFeedback(fb.id, { status: newStatus });
            setFeedbacks(prev =>
                prev.map(f => f.id === fb.id ? { ...f, status: newStatus } : f)
            );
        } catch (err) {
            console.error('상태 변경 실패:', err);
        }
    }, []);

    const handleDelete = useCallback(async () => {
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
    }, [deleteTarget]);

    // 필터링
    const filteredRaw = feedbacks.filter(fb => {
        if (filter === 'unread' && (fb.status === 'read' || fb.status === 'resolved')) return false;
        if (filter === 'resolved' && fb.status === 'unread') return false;

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

    // 정렬/그룹핑
    const groupedFeedbacks = useMemo(() => {
        const groups = new Map<string, { key: string; name: string; email: string; orgName: string; items: Feedback[]; unreadCount: number }>();
        for (const fb of filteredRaw) {
            const key = fb.userEmail || fb.userName || fb.id;
            if (!groups.has(key)) {
                const orgId = fb.organizationId || '';
                groups.set(key, {
                    key,
                    name: fb.userName || '이름 없음',
                    email: fb.userEmail || '',
                    orgName: fb.organizationName || (orgId ? (orgNames[orgId] || '') : ''),
                    items: [],
                    unreadCount: 0,
                });
            }
            const group = groups.get(key)!;
            group.items.push(fb);
            if (fb.status !== 'read' && fb.status !== 'resolved') group.unreadCount++;
        }

        for (const group of groups.values()) {
            group.items.sort((a, b) => getTime(b) - getTime(a));
        }

        return [...groups.values()].sort(
            (a, b) => getTime(b.items[0]) - getTime(a.items[0])
        );
    }, [filteredRaw, orgNames]);

    const toggleGroup = useCallback((key: string) => {
        setExpandedGroups(prev => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    }, []);

    const handleCopyEmail = useCallback(async (e: React.MouseEvent, email: string) => {
        e.stopPropagation();
        try {
            await navigator.clipboard.writeText(email);
            setCopiedEmail(email);
            setTimeout(() => setCopiedEmail(null), 1500);
        } catch (err) {
            console.error('클립보드 복사 실패:', err);
        }
    }, []);

    const handleCopyMessage = useCallback(async (e: React.MouseEvent, fbId: string, message: string) => {
        e.stopPropagation();
        try {
            await navigator.clipboard.writeText(message);
            setCopiedMessage(fbId);
            setTimeout(() => setCopiedMessage(null), 1500);
        } catch (err) {
            console.error('본문 복사 실패:', err);
        }
    }, []);

    // AI 초안 강제 재생성
    const handleRegenerateDraft = useCallback(async (feedbackId: string) => {
        setRegeneratingDraftId(feedbackId);
        try {
            const fns = getFunctions(undefined, 'asia-northeast3');
            const fn = httpsCallable<unknown, { success: boolean; faqId: string | null; confidence: number; draft: string }>(fns, 'regenerateFeedbackDraft');
            const response = await fn({ feedbackId });
            
            if (response.data && response.data.success) {
                // 로컬 상태 업데이트
                setFeedbacks(prev => prev.map(f => f.id === feedbackId ? {
                    ...f,
                    aiDraft: response.data.draft,
                    aiMatchedFaqId: response.data.faqId,
                    aiMatchedFaqIndex: undefined,
                    aiConfidence: response.data.confidence,
                } : f));
                showToast('AI 초안이 새롭게 작성되었습니다.', 'success');
            } else {
                throw new Error('응답 실패');
            }
        } catch (err) {
            console.error('AI 초안 재생성 실패:', err);
            showToast('초안을 새로 생성하지 못했습니다. 콘솔 로그를 확인해주세요.', 'error');
        } finally {
            setRegeneratingDraftId(null);
        }
    }, [showToast]);

    // 답변 발송
    const handleSendReply = useCallback(async (feedbackId: string, replyText: string) => {
        setSendingReply(feedbackId);
        setReplyError(null);
        try {
            const fns = getFunctions(undefined, 'asia-northeast3');
            const fn = httpsCallable(fns, 'sendFeedbackReply');
            await fn({ feedbackId, replyText });
            // 로컬 상태 즉시 업데이트
            setFeedbacks(prev =>
                prev.map(f => f.id === feedbackId
                    ? { ...f, reply: replyText, status: 'resolved' as const, repliedBy: 'superAdmin' as const }
                    : f
                )
            );
            showToast('답변이 성공적으로 발송되었습니다.', 'success');
        } catch (err) {
            console.error('답변 발송 실패:', err);
            setReplyError('답변 발송에 실패했습니다. 다시 시도해주세요.');
        } finally {
            setSendingReply(null);
        }
    }, [showToast]);

    const totalFiltered = groupedFeedbacks.reduce((s, g) => s + g.items.length, 0);
    const unreadCount = feedbacks.filter(f => f.status !== 'read' && f.status !== 'resolved').length;
    const resolvedCount = feedbacks.filter(f => f.status === 'read' || f.status === 'resolved').length;

    const timelineFeedbacks = useMemo(() => {
        return [...filteredRaw].sort((a, b) => getTime(b) - getTime(a));
    }, [filteredRaw]);

    return {
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
        regeneratingDraftId,
        handleToggleResolve,
        handleDelete,
        handleSendReply,
        handleRegenerateDraft,
        groupedFeedbacks,
        timelineFeedbacks,
        toggleGroup,
        handleCopyEmail,
        handleCopyMessage,
        totalFiltered,
        unreadCount,
        resolvedCount,
    };
}
