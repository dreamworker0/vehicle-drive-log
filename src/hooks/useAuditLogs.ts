/**
 * useAuditLogs — 기관 접속기록 점검 조회
 *
 * 근거: 고시 「개인정보의 안전성 확보조치 기준」 제16조 ②(월 1회 이상 점검).
 * 점검 주체는 개인정보처리자인 기관이므로 기관 관리자가 자기 기관 기록만 본다
 * (Rules `auditLogs`가 같은 경계를 강제한다 — 화면 가림이 아니라 서버 차단이다).
 *
 * ## uid를 이름으로 바꿔 보여주는 이유
 * 기록에는 최소수집 원칙에 따라 **uid만** 남는다(이름·이메일을 남기면 로그 자체가
 * 또 하나의 개인정보 데이터셋이 된다). 그러나 점검하는 사람에게 uid는 읽을 수 없어
 * 조회 시점에 기관 구성원 목록으로 이름을 붙인다 — 저장은 uid, 표시는 이름이다.
 */
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useAuth } from './useAuth';
import { getAuditLogs, getOrganizationMembers, AUDIT_LOG_PAGE_SIZE } from '../lib/firestore';
import type { AuditLogKind } from '../lib/firestore';
import type { AuditLog } from '../types/auditLog';
import { captureError } from '../lib/sentry';

/**
 * 기간 선택지 (일) — 월 1회 점검이 기본이라 30일을 기본값으로 둔다.
 *
 * 365일이 있는 이유: 보관기간이 1년(고시 제16조)인데 선택지가 90일까지면 91일~1년 구간의
 * 기록은 **보관돼 있는데 화면으로는 볼 수 없다.** 점검 주체가 볼 수 없는 보관은 의미가 없다.
 */
export const AUDIT_LOG_DAY_OPTIONS = [7, 30, 90, 365] as const;
export type AuditLogDays = (typeof AUDIT_LOG_DAY_OPTIONS)[number];

export interface UseAuditLogsResult {
    logs: AuditLog[];
    loading: boolean;
    loadingMore: boolean;
    error: string;
    hasMore: boolean;
    kind: AuditLogKind;
    setKind: (kind: AuditLogKind) => void;
    days: AuditLogDays;
    setDays: (days: AuditLogDays) => void;
    loadMore: () => void;
    /** uid를 표시용 이름으로 바꾼다. 구성원이 아니면 축약한 uid를 돌려준다. */
    nameOf: (uid: string | null | undefined) => string;
}

export default function useAuditLogs(): UseAuditLogsResult {
    const { userData } = useAuth();
    const orgId = userData?.organizationId ?? null;

    const [logs, setLogs] = useState<AuditLog[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [error, setError] = useState('');
    const [hasMore, setHasMore] = useState(false);
    const [kind, setKind] = useState<AuditLogKind>('all');
    const [days, setDays] = useState<AuditLogDays>(30);
    const [names, setNames] = useState<Record<string, string>>({});

    /** 커서와 세대 — 필터가 바뀌면 세대를 올려 이전 응답을 폐기한다 */
    const lastDocRef = useRef<unknown | null>(null);
    const generationRef = useRef(0);

    const since = useMemo(() => {
        const d = new Date();
        d.setDate(d.getDate() - days);
        return d;
    }, [days]);

    // 구성원 이름 매핑 — 기관이 바뀔 때만 다시 읽는다
    useEffect(() => {
        if (!orgId) return;
        let cancelled = false;
        getOrganizationMembers(orgId)
            .then((members) => {
                if (cancelled) return;
                const map: Record<string, string> = {};
                for (const m of members) {
                    // users 문서 ID가 uid다. uid 필드가 따로 있으면 그것도 함께 매핑한다.
                    if (m.id) map[m.id] = m.name || m.email || m.id;
                    if (m.uid) map[m.uid] = m.name || m.email || m.uid;
                }
                setNames(map);
            })
            .catch((err) => {
                // 이름을 못 붙여도 기록 자체는 보여준다 — 점검을 막을 이유가 아니다
                captureError(err, { context: 'useAuditLogs.getOrganizationMembers', orgId });
            });
        return () => { cancelled = true; };
    }, [orgId]);

    // 첫 페이지 — 기관·기간·유형이 바뀌면 처음부터 다시 읽는다
    useEffect(() => {
        if (!orgId) {
            setLoading(false);
            return;
        }
        const generation = ++generationRef.current;
        lastDocRef.current = null;
        setLoading(true);
        setError('');

        getAuditLogs(orgId, { since, kind })
            .then((page) => {
                if (generation !== generationRef.current) return; // 필터가 바뀌었으면 폐기
                setLogs(page.logs);
                lastDocRef.current = page.lastDoc;
                setHasMore(page.hasMore);
            })
            .catch(() => {
                if (generation !== generationRef.current) return;
                // captureError는 도메인 함수가 이미 보고했다 — 여기서는 화면 문구만 세운다
                setLogs([]);
                setHasMore(false);
                setError('접속기록을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.');
            })
            .finally(() => {
                if (generation === generationRef.current) setLoading(false);
            });
    }, [orgId, since, kind]);

    const loadMore = useCallback(() => {
        if (!orgId || !hasMore || loadingMore || !lastDocRef.current) return;
        const generation = generationRef.current;
        setLoadingMore(true);

        getAuditLogs(orgId, { since, kind, startAfter: lastDocRef.current })
            .then((page) => {
                if (generation !== generationRef.current) return;
                setLogs((prev) => [...prev, ...page.logs]);
                lastDocRef.current = page.lastDoc;
                setHasMore(page.hasMore);
            })
            .catch(() => {
                if (generation !== generationRef.current) return;
                setError('추가 기록을 불러오지 못했습니다.');
            })
            .finally(() => {
                if (generation === generationRef.current) setLoadingMore(false);
            });
    }, [orgId, since, kind, hasMore, loadingMore]);

    const nameOf = useCallback((uid: string | null | undefined): string => {
        if (!uid) return '알 수 없음';
        const name = names[uid];
        if (name) return name;
        // 탈퇴 계정이나 서비스 운영자(superAdmin)는 구성원 목록에 없다.
        // uid 전체는 화면에서 의미가 없고 줄만 길어져 앞 6자만 보여준다.
        return `미확인 계정(${uid.slice(0, 6)})`;
    }, [names]);

    return {
        logs, loading, loadingMore, error, hasMore,
        kind, setKind, days, setDays, loadMore, nameOf,
    };
}

/** 목록 하단의 '더 보기'가 한 번에 늘리는 건수 — 화면 안내 문구에 쓴다 */
export const AUDIT_LOG_LOAD_MORE_SIZE = AUDIT_LOG_PAGE_SIZE;
