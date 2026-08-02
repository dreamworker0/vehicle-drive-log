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
import type { AuditAction, AuditLog, AuditTargetType } from '../../types/auditLog';
import { formatTimestampFull } from '../../lib/dateUtils';

/** 수행업무 표기 — 고시의 '수행업무'를 관리자가 읽는 말로 옮긴다 */
const ACTION_LABEL: Record<AuditAction, string> = {
    login: '접속',
    create: '생성',
    update: '수정',
    delete: '삭제',
    export: '반출',
    read: '열람',
};

const ACTION_BADGE: Record<AuditAction, string> = {
    login: 'badge-primary',
    create: 'badge-success',
    update: 'badge-warning',
    delete: 'badge-danger',
    export: 'badge-warning',
    read: 'badge-neutral',
};

const TARGET_LABEL: Record<AuditTargetType, string> = {
    driveLog: '운행일지',
    user: '직원 정보',
    session: '로그인',
    export: '내보내기',
    orgDocument: '기관 증빙서류',
};

/** 반출 대상 — 서버(recordExport)의 DATASETS 화이트리스트와 1:1 */
const DATASET_LABEL: Record<string, string> = {
    driveLogs: '운행일지',
    dailyLogs: '일별 운행일지',
    fuelLogs: '주유 기록',
    hipassCharges: '하이패스 충전 기록',
    maintenance: '정비 기록',
};

const FORMAT_LABEL: Record<string, string> = { excel: '엑셀', pdf: 'PDF' };

/** 변경 필드 — 서버(AUDITED_FIELDS) 화이트리스트와 1:1. 없는 이름은 원문을 그대로 보여준다. */
const FIELD_LABEL: Record<string, string> = {
    organizationId: '소속 기관',
    organizationStatus: '기관 상태',
    driverUid: '운전자',
    driverName: '운전자 이름',
    createdByUid: '작성자',
    coDriverUids: '공동운전자',
    coDriverNames: '공동운전자 이름',
    passengerNames: '탑승자',
    date: '운행일',
    startLocation: '출발지',
    destination: '목적지',
    purpose: '용무',
    notes: '비고',
    name: '이름',
    email: '이메일',
    phone: '연락처',
    photoURL: '프로필 사진',
    role: '권한',
    status: '계정 상태',
    consent: '약관 동의',
};

/** 행위자를 어떻게 알아냈는지 — 기록의 신뢰 수준을 숨기지 않고 그대로 보여준다 */
const ACTOR_SOURCE_NOTE: Record<AuditLog['actorSource'], string> = {
    stamp: '',              // 위조 불가 — 부연할 것이 없다
    auth: '',               // 인증 토큰에서 확인 — 위조 불가
    document: '문서 기록으로 추정',
    unknown: '행위자 미확인',
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
function LogDetail({ log, nameOf }: { log: AuditLog; nameOf: (uid?: string | null) => string }) {
    const rows: Array<[string, string]> = [];

    if (log.targetType === 'session') {
        if (log.ip) rows.push(['접속지 IP', log.ip]);
        if (log.userAgent) rows.push(['접속 환경', log.userAgent]);
    }

    if (log.action === 'export') {
        const format = log.exportFormat ? FORMAT_LABEL[log.exportFormat] ?? log.exportFormat : '';
        const dataset = log.exportDataset ? DATASET_LABEL[log.exportDataset] ?? log.exportDataset : '';
        if (dataset || format) rows.push(['반출 대상', [dataset, format && `${format} 파일`].filter(Boolean).join(' · ')]);
        if (typeof log.recordCount === 'number') rows.push(['반출 건수', `${log.recordCount.toLocaleString()}건`]);
    }

    if (log.changedFields?.length) {
        rows.push(['바뀐 항목', log.changedFields.map((f) => FIELD_LABEL[f] ?? f).join(', ')]);
    }

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
        kind, setKind, days, setDays, loadMore, nameOf,
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
                <div className="flex gap-2 mb-4">
                    {AUDIT_LOG_DAY_OPTIONS.map((option) => (
                        <SegmentButton key={option} active={days === option} onClick={() => setDays(option as AuditLogDays)}>
                            최근 {option}일
                        </SegmentButton>
                    ))}
                </div>

                <p className="text-xs font-medium text-surface-400 dark:text-surface-500 mb-2">유형</p>
                <div className="flex gap-2">
                    {KIND_TABS.map((tab) => (
                        <SegmentButton key={tab.value} active={kind === tab.value} onClick={() => setKind(tab.value)}>
                            {tab.label}
                        </SegmentButton>
                    ))}
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
                                        {TARGET_LABEL[log.targetType]} {ACTION_LABEL[log.action]}
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
                                <LogDetail log={log} nameOf={nameOf} />
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
