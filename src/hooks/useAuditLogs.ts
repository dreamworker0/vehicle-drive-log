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
import {
    getAuditLogs, getAuditLogsForExport, getOrganizationMembers,
    AUDIT_LOG_PAGE_SIZE, AUDIT_LOG_EXPORT_MAX,
} from '../lib/firestore';
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

/** 직접 지정한 기간 (YYYY-MM-DD). 둘 다 채워졌을 때만 프리셋을 대신한다. */
export interface AuditLogDateRange {
    start: string;
    end: string;
}

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
    /** 직접 지정 기간. 빈 문자열이면 프리셋(days)을 쓴다. */
    range: AuditLogDateRange;
    setRange: (patch: Partial<AuditLogDateRange>) => void;
    /** 직접 지정 기간이 적용 중인지 — 화면이 프리셋 선택 표시를 끄는 데 쓴다 */
    rangeActive: boolean;
    loadMore: () => void;
    /** uid를 표시용 이름으로 바꾼다. 구성원이 아니면 축약한 uid를 돌려준다. */
    nameOf: (uid: string | null | undefined) => string;
    /** 선택한 기간·유형 전체를 엑셀로 내보낸다(화면에 불러온 만큼이 아니라 기간 전체) */
    exportExcel: () => void;
    exporting: boolean;
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
    const [range, setRangeState] = useState<AuditLogDateRange>({ start: '', end: '' });
    const [names, setNames] = useState<Record<string, string>>({});
    const [exporting, setExporting] = useState(false);

    /** 커서와 세대 — 필터가 바뀌면 세대를 올려 이전 응답을 폐기한다 */
    const lastDocRef = useRef<unknown | null>(null);
    const generationRef = useRef(0);

    /**
     * 직접 지정 기간은 **양쪽이 다 채워졌을 때만** 적용한다.
     * 한쪽만 입력된 중간 상태에서 조회를 갈아치우면 날짜를 타이핑하는 동안 목록이
     * 엉뚱한 범위로 몇 번씩 바뀐다.
     */
    const rangeActive = Boolean(range.start && range.end && range.start <= range.end);

    /**
     * 프리셋과 직접 지정을 **따로** 기억한다.
     *
     * 하나의 useMemo로 묶으면 날짜 입력값이 바뀔 때마다(아직 적용 전인 한쪽만 입력한
     * 상태에서도) 프리셋 Date가 새 객체로 다시 만들어져, 조회 이펙트의 의존성이 바뀐 것으로
     * 보이고 **같은 기간을 다시 읽는다**. 날짜를 타이핑하는 동안 조회가 몇 번씩 도는 낭비다.
     */
    const presetSince = useMemo(() => {
        const d = new Date();
        d.setDate(d.getDate() - days);
        return d;
    }, [days]);

    const rangeBounds = useMemo(() => {
        if (!rangeActive) return null;
        return {
            since: new Date(`${range.start}T00:00:00`),
            // 종료일은 그 날 하루를 포함해야 한다 — 23:59:59.999까지.
            // 자정으로 자르면 마지막 날 기록이 통째로 빠져 그 날은 점검에서 누락된다.
            until: new Date(`${range.end}T23:59:59.999`),
        };
    }, [rangeActive, range.start, range.end]);

    const since = rangeBounds?.since ?? presetSince;
    const until = rangeBounds?.until;

    const setRange = useCallback((patch: Partial<AuditLogDateRange>) => {
        setRangeState((prev) => ({ ...prev, ...patch }));
    }, []);

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

        getAuditLogs(orgId, { since, until, kind })
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
    }, [orgId, since, until, kind]);

    const loadMore = useCallback(() => {
        if (!orgId || !hasMore || loadingMore || !lastDocRef.current) return;
        const generation = generationRef.current;
        setLoadingMore(true);

        getAuditLogs(orgId, { since, until, kind, startAfter: lastDocRef.current })
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
    }, [orgId, since, until, kind, hasMore, loadingMore]);

    const nameOf = useCallback((uid: string | null | undefined): string => {
        if (!uid) return '알 수 없음';
        const name = names[uid];
        if (name) return name;
        // 탈퇴 계정이나 서비스 운영자(superAdmin)는 구성원 목록에 없다.
        // uid 전체는 화면에서 의미가 없고 줄만 길어져 앞 6자만 보여준다.
        return `미확인 계정(${uid.slice(0, 6)})`;
    }, [names]);

    /**
     * 선택한 기간·유형 전체를 엑셀로 내보낸다.
     *
     * 화면 목록(50건 단위)이 아니라 **기간 전체**를 다시 읽는다 — 점검 결과를 파일로
     * 남기는 용도이므로 "스크롤한 만큼만" 담기면 증빙이 되지 않는다.
     * 상한(5,000건)에 걸리면 잘렸다는 사실을 알린다 — 조용히 자르면 전량으로 오해한다.
     */
    const exportExcel = useCallback(() => {
        if (!orgId || exporting) return;
        setExporting(true);
        setError('');

        getAuditLogsForExport(orgId, { since, until, kind })
            .then(async (result) => {
                if (result.logs.length === 0) {
                    setError('선택한 기간에 내보낼 기록이 없습니다.');
                    return;
                }
                const { downloadAuditLogsExcel } = await import('../lib/excelExport');
                const label = rangeActive
                    ? `${range.start}_${range.end}`
                    : `최근${days}일`;
                await downloadAuditLogsExcel(result.logs, nameOf, `접속기록_${label}`);
                if (result.truncated) {
                    setError(`기록이 많아 최근 ${AUDIT_LOG_EXPORT_MAX.toLocaleString()}건만 내보냈습니다. 기간을 좁혀 다시 받아주세요.`);
                }
            })
            .catch((err) => {
                captureError(err, { context: 'useAuditLogs.exportExcel', orgId });
                setError('내보내기에 실패했습니다. 잠시 후 다시 시도해주세요.');
            })
            .finally(() => setExporting(false));
    }, [orgId, exporting, since, until, kind, rangeActive, range.start, range.end, days, nameOf]);

    return {
        logs, loading, loadingMore, error, hasMore,
        kind, setKind, days, setDays, range, setRange, rangeActive,
        loadMore, nameOf, exportExcel, exporting,
    };
}

/** 목록 하단의 '더 보기'가 한 번에 늘리는 건수 — 화면 안내 문구에 쓴다 */
export const AUDIT_LOG_LOAD_MORE_SIZE = AUDIT_LOG_PAGE_SIZE;
