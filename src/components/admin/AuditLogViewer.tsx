/**
 * AuditLogViewer — 접속기록 점검 화면 (기관 관리자 전용)
 *
 * 근거: 고시 「개인정보의 안전성 확보조치 기준」 제16조 ②는 접속기록을 **월 1회 이상**
 * 점검하도록 한다. 점검 주체는 개인정보처리자인 기관이므로(이용약관 제9조) 기관 관리자가
 * 자기 기관 기록을 확인한다. 데이터·권한은 `useAuditLogs` + Rules가 담당하고 여기는 표시만 한다.
 *
 * 기록에 없는 것은 화면에도 없다 — 변경된 **값**, 반출한 **내용**, 검색 조건은 애초에
 * 저장하지 않는다(감사 로그가 개인정보 사본이 되는 순환을 막기 위한 설계).
 */
import useAuditLogs, { AUDIT_LOG_DAY_OPTIONS, type AuditLogDays } from '../../hooks/useAuditLogs';
import type { AuditLogKind } from '../../lib/firestore';
import type { AuditAction, AuditLog } from '../../types/auditLog';
import type { DriveLog } from '../../types/driveLog';
import { formatTimestampFull } from '../../lib/dateUtils';
import {
    ACTOR_SOURCE_NOTE, describeChangedFields, describeDriveLog, describeEvent, describeExportTarget,
} from '../../lib/auditLogLabels';

const ACTION_BADGE: Record<AuditAction, string> = {
    login: 'badge-primary',
    create: 'badge-success',
    update: 'badge-warning',
    delete: 'badge-danger',
    export: 'badge-warning',
    read: 'badge-neutral',
};

/** 기간 표기 — 365일은 '1년'이라고 읽는 편이 보관기간(1년)과 바로 연결된다 */
const DAY_LABEL: Record<AuditLogDays, string> = {
    7: '최근 7일',
    30: '최근 30일',
    90: '최근 90일',
    365: '최근 1년',
};

const KIND_TABS: Array<{ value: AuditLogKind; label: string }> = [
    { value: 'all', label: '전체' },
    { value: 'access', label: '접속' },
    { value: 'change', label: '변경' },
    { value: 'export', label: '반출·열람' },
];

/** 세그먼트 버튼 — 터치 타겟 48px(D16)을 지키고 선택 상태를 색으로 구분한다 */
function SegmentButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-pressed={active}
            className={`flex-1 min-h-[48px] px-3 rounded-xl text-sm font-medium transition-colors ${
                active
                    ? 'bg-primary-600 text-white shadow-md'
                    : 'bg-surface-100 text-surface-600 hover:bg-surface-200 dark:bg-surface-700 dark:text-surface-300 dark:hover:bg-surface-600'
            }`}
        >
            {children}
        </button>
    );
}

/** 기록 1건의 상세 — 유형에 따라 남아 있는 항목만 보여준다 */
function LogDetail({ log, nameOf, driveLogOf }: {
    log: AuditLog;
    nameOf: (uid?: string | null) => string;
    driveLogOf: (id: string) => DriveLog | null | undefined;
}) {
    const rows: Array<[string, string]> = [];

    // 운행일지 기록은 "어느 운행이었는지"가 먼저 보여야 점검이 된다 — 원본에서 읽은 요약을 붙인다
    if (log.targetType === 'driveLog' && log.targetId) {
        const driveLog = driveLogOf(log.targetId);
        if (driveLog) rows.push(['운행 내용', describeDriveLog(driveLog) || '내용 없음']);
        else if (driveLog === null) rows.push(['운행 내용', '삭제된 운행일지라 내용을 확인할 수 없음']);
    }

    if (log.targetType === 'session') {
        if (log.ip) rows.push(['접속지 IP', log.ip]);
        if (log.userAgent) rows.push(['접속 환경', log.userAgent]);
    }

    if (log.action === 'export') {
        const target = describeExportTarget(log);
        if (target) rows.push(['반출 대상', target]);
        if (typeof log.recordCount === 'number') rows.push(['반출 건수', `${log.recordCount.toLocaleString()}건`]);
    }

    const changed = describeChangedFields(log.changedFields);
    if (changed) rows.push(['바뀐 항목', changed]);

    if (log.subjectUids.length > 0) {
        rows.push(['대상 직원', log.subjectUids.map((uid) => nameOf(uid)).join(', ')]);
    }

    if (rows.length === 0) return null;

    return (
        <dl className="mt-2 space-y-1">
            {rows.map(([label, value]) => (
                <div key={label} className="flex gap-2 text-xs">
                    <dt className="text-surface-400 dark:text-surface-500 flex-shrink-0">{label}</dt>
                    <dd className="text-surface-600 dark:text-surface-300 break-all">{value}</dd>
                </div>
            ))}
        </dl>
    );
}

export default function AuditLogViewer() {
    const {
        logs, loading, loadingMore, error, hasMore,
        kind, setKind, days, setDays, range, setRange, rangeActive,
        memberUid, setMemberUid, members,
        vehicleId, setVehicleId, vehicles,
        loadMore, nameOf, driveLogOf, exportExcel, exporting,
    } = useAuditLogs();

    return (
        <div className="max-w-2xl mx-auto animate-fade-in">
            <h1 className="text-2xl font-bold text-surface-900 dark:text-surface-100 mb-2">접속기록</h1>
            <p className="text-sm text-surface-500 dark:text-surface-400 mb-6 leading-relaxed">
                개인정보에 대한 접속·변경·반출 기록입니다. 개인정보 보호법에 따라 1년간 보관된 뒤 자동으로
                파기되며, <strong className="font-semibold text-surface-600 dark:text-surface-300">월 1회 이상 점검</strong>이
                필요합니다. 바뀐 값이나 반출한 내용은 기록하지 않습니다.
            </p>

            {/* 기간 필터 */}
            <div className="glass-card p-4 mb-4">
                <p className="text-xs font-medium text-surface-400 dark:text-surface-500 mb-2">기간</p>
                {/* 선택지가 4개라 좁은 화면에서는 2×2로 접는다 — 한 줄에 넣으면 글자가 줄바꿈된다 */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
                    {AUDIT_LOG_DAY_OPTIONS.map((option) => (
                        <SegmentButton
                            key={option}
                            // 직접 지정이 적용 중이면 프리셋 선택 표시를 끈다 — 둘 다 켜져 보이면
                            // 지금 어느 기간으로 보고 있는지 알 수 없다
                            active={!rangeActive && days === option}
                            onClick={() => { setRange({ start: '', end: '' }); setDays(option as AuditLogDays); }}
                        >
                            {DAY_LABEL[option]}
                        </SegmentButton>
                    ))}
                </div>

                {/*
                  직접 지정 — 월 1회 점검은 "7월 1일~31일"처럼 달 경계로 보는 것이 자연스럽다.
                  프리셋은 오늘 기준 역산이라 지난달을 정확히 잘라낼 수 없다.
                */}
                <div className="flex items-center gap-2 mb-4">
                    <input
                        type="date"
                        aria-label="시작일"
                        value={range.start}
                        max={range.end || undefined}
                        onChange={(e) => setRange({ start: e.target.value })}
                        className="input flex-1 min-h-[48px]"
                    />
                    <span className="text-sm text-surface-400 dark:text-surface-500">~</span>
                    <input
                        type="date"
                        aria-label="종료일"
                        value={range.end}
                        min={range.start || undefined}
                        onChange={(e) => setRange({ end: e.target.value })}
                        className="input flex-1 min-h-[48px]"
                    />
                    {rangeActive && (
                        <button
                            type="button"
                            onClick={() => setRange({ start: '', end: '' })}
                            className="btn-secondary min-h-[48px] px-3 text-sm flex-shrink-0"
                        >
                            초기화
                        </button>
                    )}
                </div>

                {/*
                  직원 — 그 직원이 직접 한 일과 대상이 된 일을 함께 본다. 한쪽만 보면
                  관리자의 엑셀 반출(대상 없음)이나 서버가 남긴 동의 기록(행위자 없음)이 빠진다.
                */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-2 mb-4">
                    <div>
                        <p className="text-xs font-medium text-surface-400 dark:text-surface-500 mb-2">직원</p>
                        <select
                            aria-label="직원"
                            value={memberUid}
                            onChange={(e) => setMemberUid(e.target.value)}
                            className="input w-full min-h-[48px] mb-3 sm:mb-0"
                        >
                            <option value="">전체 직원</option>
                            {members.map((m) => (
                                <option key={m.uid} value={m.uid}>{m.name}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <p className="text-xs font-medium text-surface-400 dark:text-surface-500 mb-2">차량</p>
                        <select
                            aria-label="차량"
                            value={vehicleId}
                            onChange={(e) => setVehicleId(e.target.value)}
                            className="input w-full min-h-[48px]"
                        >
                            <option value="">전체 차량</option>
                            {vehicles.map((v) => (
                                <option key={v.id} value={v.id}>{v.name}</option>
                            ))}
                        </select>
                    </div>
                </div>
                {/* 차량 정보는 서버가 이날부터 남기기 시작했다 — 그 전 기록이 안 나오는 걸 '기록 없음'으로 오해하지 않게 */}
                {vehicleId && (
                    <p className="text-xs text-surface-400 dark:text-surface-500 -mt-2 mb-4">
                        차량별 조회는 2026년 10월 5일 이후 기록부터 가능합니다.
                    </p>
                )}

                <p className="text-xs font-medium text-surface-400 dark:text-surface-500 mb-2">유형</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {KIND_TABS.map((tab) => (
                        <SegmentButton key={tab.value} active={kind === tab.value} onClick={() => setKind(tab.value)}>
                            {tab.label}
                        </SegmentButton>
                    ))}
                </div>

                {/*
                  내보내기 — 화면에 불러온 만큼이 아니라 **선택한 기간 전체**를 담는다.
                  이 파일은 접속지 IP를 담으므로 이 내보내기 자체가 개인정보 반출이고,
                  그 사실이 다시 접속기록에 남는다(점검 관점에서는 그래야 맞다).
                */}
                <div className="mt-4 pt-4 border-t border-surface-100 dark:border-surface-700">
                    <button
                        type="button"
                        onClick={exportExcel}
                        disabled={exporting || loading}
                        className="btn-secondary w-full min-h-[48px] text-sm"
                    >
                        {exporting ? '내보내는 중...' : '엑셀로 내보내기'}
                    </button>
                    <p className="text-xs text-surface-400 dark:text-surface-500 mt-2 leading-relaxed">
                        선택한 기간·직원·차량·유형의 기록 전체가 담깁니다. 접속지 IP가 포함되므로 파일 보관에 주의해 주세요 —
                        내보낸 사실은 접속기록에 남습니다.
                    </p>
                </div>
            </div>

            {error && (
                <div className="mb-4 p-4 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/50 text-red-600 dark:text-red-400 text-sm">
                    {error}
                </div>
            )}

            {loading ? (
                <div className="flex items-center justify-center py-20">
                    <div className="w-8 h-8 spinner" />
                </div>
            ) : error && logs.length === 0 ? (
                // 조회가 실패한 것과 기간에 기록이 없는 것은 다른 상태다. 오류 문구 아래에
                // "기록이 없습니다"를 함께 띄우면 실패를 '기록 없음'으로 오해하게 된다.
                null
            ) : logs.length === 0 ? (
                <div className="glass-card p-8 text-center">
                    <p className="text-sm text-surface-500 dark:text-surface-400">선택한 기간에 기록이 없습니다.</p>
                    <p className="text-xs text-surface-400 dark:text-surface-500 mt-1">기간을 늘려 확인해 보세요.</p>
                </div>
            ) : (
                <ul className="space-y-2">
                    {logs.map((log) => {
                        const note = ACTOR_SOURCE_NOTE[log.actorSource];
                        return (
                            <li key={log.id} className="glass-card p-4">
                                <div className="flex items-center justify-between gap-2 mb-1">
                                    <span className={ACTION_BADGE[log.action]}>
                                        {describeEvent(log)}
                                    </span>
                                    <span className="text-xs text-surface-400 dark:text-surface-500 flex-shrink-0">
                                        {formatTimestampFull(log.at) ?? '-'}
                                    </span>
                                </div>
                                <p className="text-sm text-surface-700 dark:text-surface-200">
                                    {nameOf(log.actorUid)}
                                    {note && (
                                        <span className="ml-1.5 text-xs text-surface-400 dark:text-surface-500">({note})</span>
                                    )}
                                </p>
                                <LogDetail log={log} nameOf={nameOf} driveLogOf={driveLogOf} />
                            </li>
                        );
                    })}
                </ul>
            )}

            {hasMore && !loading && (
                <button
                    type="button"
                    onClick={loadMore}
                    disabled={loadingMore}
                    className="btn-secondary w-full min-h-[48px] mt-4"
                >
                    {loadingMore ? '불러오는 중...' : '이전 기록 더 보기'}
                </button>
            )}

            {/* 기록의 한계를 화면에서 숨기지 않는다 — 점검하는 사람이 알아야 판단할 수 있다 */}
            {!loading && logs.length > 0 && (
                <p className="text-xs text-surface-400 dark:text-surface-500 mt-6 leading-relaxed">
                    엑셀·PDF 내보내기는 브라우저에서 만들어지므로 기록이 남지 않는 경로가 있을 수 있습니다.
                    삭제 기록의 행위자는 확정할 수 없어 '행위자 미확인'으로 남습니다 —
                    같은 시각의 접속 기록과 함께 보면 좁힐 수 있습니다.
                </p>
            )}
        </div>
    );
}
