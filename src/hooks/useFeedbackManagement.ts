import { useState, useEffect, useMemo, useCallback } from 'react';
import { subscribeFeedbacks, updateFeedback, deleteFeedback, getOrganization } from '../lib/firestore';
import type { Feedback } from '../types';

function getTime(fb: Feedback) {
    const t = fb.createdAt;
    if (!t) return 0;
    if ('toMillis' in t) return (t as { toMillis: () => number }).toMillis();
    if ('seconds' in t) return (t as { seconds: number }).seconds * 1000;
    return 0;
}

export default function useFeedbackManagement() {
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

    const handleToggleRead = useCallback(async (fb: Feedback) => {
        const newStatus = fb.status === 'read' ? 'unread' : 'read';
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
        if (filter === 'unread' && fb.status === 'read') return false;
        if (filter === 'read' && fb.status !== 'read') return false;

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

        for (const group of groups.values()) {
            group.items.sort((a, b) => getTime(b) - getTime(a));
        }

        return [...groups.values()].sort(
            (a, b) => getTime(b.items[0]) - getTime(a.items[0])
        );
    }, [filteredRaw]);

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

    const totalFiltered = groupedFeedbacks.reduce((s, g) => s + g.items.length, 0);
    const unreadCount = feedbacks.filter(f => f.status !== 'read').length;

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
        handleToggleRead,
        handleDelete,
        groupedFeedbacks,
        toggleGroup,
        handleCopyEmail,
        handleCopyMessage,
        totalFiltered,
        unreadCount,
    };
}
