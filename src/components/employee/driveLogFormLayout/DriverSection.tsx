import { memo, useState, useEffect } from 'react';
import type { User as UserDoc } from '../../../types/user';
import ConfirmModal from '../../common/ConfirmModal';

interface DriverSectionProps {
    /** 대표 운전자 후보(본인 + 조직원) */
    driverCandidates: UserDoc[];
    /** 현재 선택된 대표 운전자 uid */
    driverUid: string;
    /** 대표 운전자 선택 핸들러 */
    onSelectDriver: (uid: string, name: string) => void;
    /** 대표 운전자 변경 가능 여부(신규 작성·관리자·본인 일지 편집) */
    canEditDriver: boolean;
    /** 공동 운전자 후보(조직원, 본인 제외) */
    members: UserDoc[];
    /** 선택된 공동 운전자 */
    selectedCoDrivers: UserDoc[];
    /** 공동 운전자 토글 */
    toggleCoDriver: (member: UserDoc) => void;
    /** 공동 운전자 직접 입력(쉼표 구분) */
    externalCoDriverNames: string;
    setExternalCoDriverNames: (names: string) => void;
}

/** 목록이 이 수 이하면 검색 없이 바로 노출, 초과하면 검색 입력을 요구 */
const INLINE_LIST_THRESHOLD = 8;
/** 검색 결과 최대 표시 수 */
const MAX_RESULTS = 8;

const displayName = (m: UserDoc) => m.name || m.email?.split('@')[0] || '이름없음';
const subLabel = (m: UserDoc) => m.email || '';

const matches = (m: UserDoc, q: string) => {
    const term = q.trim().toLowerCase();
    if (!term) return true;
    return displayName(m).toLowerCase().includes(term) || (m.email || '').toLowerCase().includes(term);
};

const DriverSection = memo(function DriverSection({
    driverCandidates,
    driverUid,
    onSelectDriver,
    canEditDriver,
    members,
    selectedCoDrivers,
    toggleCoDriver,
    externalCoDriverNames,
    setExternalCoDriverNames,
}: DriverSectionProps) {
    // 접기/펼치기 (기본: 접힘 — 대부분 본인 그대로 사용)
    const [isExpanded, setIsExpanded] = useState(() => {
        try {
            const saved = localStorage.getItem('driveLog_driverExpanded');
            return saved !== null ? JSON.parse(saved) : false;
        } catch {
            return false;
        }
    });
    useEffect(() => {
        localStorage.setItem('driveLog_driverExpanded', JSON.stringify(isExpanded));
    }, [isExpanded]);

    // 좌/우 탭: 대표 운전자 | 공동 운전자
    const [activeTab, setActiveTab] = useState<'driver' | 'coDriver'>('driver');

    // 검색어
    const [driverQuery, setDriverQuery] = useState('');
    const [coQuery, setCoQuery] = useState('');

    // 대표 운전자 변경 확인 모달 상태
    const [pendingDriver, setPendingDriver] = useState<{ uid: string; name: string } | null>(null);

    const currentDriver = driverCandidates.find(m => m.id === driverUid);
    const currentDriverName = currentDriver ? displayName(currentDriver) : '지정된 운전자';
    // 본인 = 후보 목록의 첫 항목([self, ...members])
    const selfUid = driverCandidates[0]?.id;
    const coDriverCount = selectedCoDrivers.length + (externalCoDriverNames.trim() ? externalCoDriverNames.split(',').filter(s => s.trim()).length : 0);

    // 공동 운전자 후보 = 조직원 - 현재 대표 운전자 - 이미 선택된 공동운전자
    const coDriverPool = members.filter(m => m.id !== driverUid && !selectedCoDrivers.some(p => p.id === m.id));

    // 인원이 적으면 바로 노출, 많으면 검색해야 노출
    const buildVisible = (pool: UserDoc[], q: string) => {
        if (q.trim()) return pool.filter(m => matches(m, q)).slice(0, MAX_RESULTS);
        return pool.length <= INLINE_LIST_THRESHOLD ? pool : [];
    };
    const visibleDrivers = buildVisible(driverCandidates, driverQuery);
    const visibleCoDrivers = buildVisible(coDriverPool, coQuery);
    const needDriverSearchHint = !driverQuery.trim() && driverCandidates.length > INLINE_LIST_THRESHOLD;
    const needCoSearchHint = !coQuery.trim() && coDriverPool.length > INLINE_LIST_THRESHOLD;

    const handleDriverPick = (m: UserDoc) => {
        setDriverQuery('');
        if (m.id === driverUid) return; // 이미 선택됨
        if (m.id === selfUid) {
            // 본인으로 되돌리는 것은 경고 없이 즉시 반영
            onSelectDriver(m.id, displayName(m));
            return;
        }
        // 타인을 운전자로 지정 → 강한 경고
        setPendingDriver({ uid: m.id, name: displayName(m) });
    };

    const handleCoPick = (m: UserDoc) => {
        toggleCoDriver(m);
        setCoQuery('');
    };

    return (
        <div className="glass-card p-4">
            {/* 헤더 (요약 + 펼치기 토글) */}
            <div className="flex items-center justify-between">
                <div className="min-w-0 flex items-center gap-2 flex-wrap">
                    <span className="label mb-0">🚗 운전자</span>
                    <span className="text-sm font-bold text-primary-600 dark:text-primary-400 truncate">
                        {currentDriverName}
                    </span>
                    {coDriverCount > 0 && (
                        <span className="text-xs text-surface-500 dark:text-surface-400">
                            🤝 공동 {coDriverCount}명
                        </span>
                    )}
                </div>
                <button
                    type="button"
                    onClick={() => setIsExpanded(!isExpanded)}
                    className="text-xs px-3 py-2 min-h-[48px] rounded-md bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-300 hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors flex items-center justify-center font-medium flex-shrink-0"
                >
                    {isExpanded ? '닫기 ▲' : '변경 ▼'}
                </button>
            </div>

            {isExpanded && (
                <div className="mt-3">
                    {/* 좌/우 탭 */}
                    <div className="flex gap-1 p-1 rounded-lg bg-surface-100 dark:bg-surface-800 mb-3">
                        <button
                            type="button"
                            onClick={() => setActiveTab('driver')}
                            className={`flex-1 min-h-[44px] rounded-md text-sm font-medium transition-all ${activeTab === 'driver'
                                ? 'bg-white dark:bg-surface-700 text-primary-700 dark:text-primary-300 shadow-sm'
                                : 'text-surface-500 dark:text-surface-400'
                                }`}
                        >
                            🚗 대표 운전자
                        </button>
                        <button
                            type="button"
                            onClick={() => setActiveTab('coDriver')}
                            className={`flex-1 min-h-[44px] rounded-md text-sm font-medium transition-all ${activeTab === 'coDriver'
                                ? 'bg-white dark:bg-surface-700 text-primary-700 dark:text-primary-300 shadow-sm'
                                : 'text-surface-500 dark:text-surface-400'
                                }`}
                        >
                            🤝 공동 운전자{coDriverCount > 0 ? ` (${coDriverCount})` : ''}
                        </button>
                    </div>

                    {/* 대표 운전자 탭 */}
                    {activeTab === 'driver' && (
                        <div>
                            <p className="text-xs text-surface-500 dark:text-surface-400 mb-2">
                                현재 운전자: <span className="font-bold text-primary-600 dark:text-primary-400">{currentDriverName}</span> · 주행거리가 이 사람에게 기록됩니다.
                            </p>
                            {canEditDriver ? (
                                <>
                                    <input
                                        type="text"
                                        value={driverQuery}
                                        onChange={e => setDriverQuery(e.target.value)}
                                        placeholder={driverCandidates.length > INLINE_LIST_THRESHOLD ? '운전자 이름 검색…' : '운전자 검색…'}
                                        className="input min-h-[48px] text-sm py-1.5 px-3 w-full mb-2"
                                    />
                                    {needDriverSearchHint ? (
                                        <p className="text-xs text-surface-400 dark:text-surface-500 py-2">이름을 입력해 운전자를 검색하세요.</p>
                                    ) : (
                                        <MemberList
                                            list={visibleDrivers}
                                            query={driverQuery}
                                            selectedIds={[driverUid]}
                                            onPick={handleDriverPick}
                                        />
                                    )}
                                </>
                            ) : (
                                <div className="px-4 py-2 min-h-[48px] flex items-center rounded-lg bg-surface-50 dark:bg-surface-800 border border-surface-200 dark:border-surface-600 text-sm font-medium text-surface-700 dark:text-surface-200">
                                    {currentDriverName}
                                    <span className="ml-2 text-xs font-normal text-surface-400 dark:text-surface-500">
                                        (수정 권한 없음)
                                    </span>
                                </div>
                            )}
                        </div>
                    )}

                    {/* 공동 운전자 탭 */}
                    {activeTab === 'coDriver' && (
                        <div>
                            <p className="text-xs text-surface-500 dark:text-surface-400 mb-2">
                                두 명 이상이 나눠 운전한 경우 함께 운전한 사람을 기록합니다. 주행거리는 대표 운전자에게 귀속됩니다.
                            </p>

                            {/* 선택된 공동 운전자(제거 가능) */}
                            {selectedCoDrivers.length > 0 && (
                                <div className="flex flex-wrap gap-1.5 mb-2">
                                    {selectedCoDrivers.map(m => (
                                        <button
                                            key={m.id}
                                            type="button"
                                            onClick={() => toggleCoDriver(m)}
                                            className="px-4 py-2 min-h-[48px] rounded-full text-xs font-medium border bg-primary-100 dark:bg-primary-900/40 border-primary-300 text-primary-700 dark:text-primary-300 ring-1 ring-primary-200 dark:ring-primary-900/40"
                                        >
                                            ✓ {displayName(m)} ✕
                                        </button>
                                    ))}
                                </div>
                            )}

                            <input
                                type="text"
                                value={coQuery}
                                onChange={e => setCoQuery(e.target.value)}
                                placeholder={coDriverPool.length > INLINE_LIST_THRESHOLD ? '조직원 이름 검색해 추가…' : '조직원 검색해 추가…'}
                                className="input min-h-[48px] text-sm py-1.5 px-3 w-full mb-2"
                            />
                            {needCoSearchHint ? (
                                <p className="text-xs text-surface-400 dark:text-surface-500 py-2">이름을 입력해 조직원을 검색하세요.</p>
                            ) : (
                                <MemberList
                                    list={visibleCoDrivers}
                                    query={coQuery}
                                    selectedIds={[]}
                                    onPick={handleCoPick}
                                />
                            )}

                            <div className="mt-3 border-t border-surface-100 dark:border-surface-700 pt-3">
                                <p className="text-xs text-surface-500 dark:text-surface-400 mb-1">조직원이 아닌 사람은 직접 입력</p>
                                <input
                                    type="text"
                                    value={externalCoDriverNames}
                                    onChange={e => setExternalCoDriverNames(e.target.value)}
                                    placeholder="예: 홍길동, 김철수"
                                    className="input min-h-[48px] text-sm py-1.5 px-3 w-full"
                                />
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* 대표 운전자 변경 강한 경고 */}
            <ConfirmModal
                open={!!pendingDriver}
                title="⚠️ 운전자 변경 확인"
                message={`이 운행일지의 운전자를 '${pendingDriver?.name}'(으)로 지정합니다.\n\n주행거리·운행 책임이 본인이 아닌 '${pendingDriver?.name}'에게 기록됩니다. 실제 운전자가 맞는지 확인하세요.`}
                confirmText="변경"
                cancelText="취소"
                confirmColor="warning"
                onConfirm={() => {
                    if (pendingDriver) onSelectDriver(pendingDriver.uid, pendingDriver.name);
                    setPendingDriver(null);
                }}
                onCancel={() => setPendingDriver(null)}
            />
        </div>
    );
});

/** 검색 결과/후보 목록 렌더 (이름 + 이메일 부가표시로 동명이인 구분) */
function MemberList({
    list,
    query,
    selectedIds,
    onPick,
}: {
    list: UserDoc[];
    query: string;
    selectedIds: string[];
    onPick: (m: UserDoc) => void;
}) {
    if (list.length === 0) {
        return (
            <p className="text-xs text-surface-400 dark:text-surface-500 py-2">
                {query.trim() ? '검색 결과가 없습니다.' : '선택 가능한 사람이 없습니다.'}
            </p>
        );
    }
    return (
        <div className="flex flex-col gap-1 max-h-56 overflow-y-auto">
            {list.map(m => {
                const isSelected = selectedIds.includes(m.id);
                const name = m.name || m.email?.split('@')[0] || '이름없음';
                const sub = subLabel(m);
                return (
                    <button
                        key={m.id}
                        type="button"
                        onClick={() => onPick(m)}
                        className={`w-full text-left px-3 py-2.5 min-h-[48px] rounded-lg border transition-all flex items-center justify-between gap-2 ${isSelected
                            ? 'bg-primary-100 dark:bg-primary-900/40 border-primary-300 text-primary-700 dark:text-primary-300'
                            : 'bg-surface-50 dark:bg-surface-800 border-surface-200 dark:border-surface-600 text-surface-700 dark:text-surface-300 hover:border-primary-300 dark:hover:border-primary-700'
                            }`}
                    >
                        <span className="flex items-center gap-2 min-w-0">
                            {isSelected && <span className="flex-shrink-0">✓</span>}
                            <span className="font-medium truncate">{name}</span>
                        </span>
                        {sub && <span className="text-xs text-surface-400 dark:text-surface-500 truncate flex-shrink-0 max-w-[45%]">{sub}</span>}
                    </button>
                );
            })}
        </div>
    );
}

export default DriverSection;
