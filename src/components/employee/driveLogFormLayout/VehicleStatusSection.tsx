import { memo, useState, useEffect } from 'react';
import { stripNegative } from '../../../hooks/utils/numberValidation';
import type { DriveLogForm } from '../../../hooks/driveLogForm/types';
import type { HipassCard } from '../../../types/hipass';

interface VehicleStatusSectionProps {
    isElectric: boolean;
    form: DriveLogForm;
    setForm: (f: DriveLogForm) => void;
    lastEndBattery: number | null;
    hipassCard: HipassCard | null;
    /** 기관 설정: 하이패스 사용 여부(기본 true). false면 하이패스 블록 숨김 */
    hipassEnabled?: boolean;
    /** 수정 모드 여부. 수정 화면에서는 하이패스 블록을 숨긴다(아래 showHipass 주석 참고) */
    isEditMode?: boolean;
    /** 오늘이 아닌 날짜의 운행인지(소급 입력). 이때도 하이패스 블록을 숨긴다 */
    isRetroactive?: boolean;
}

const VehicleStatusSection = memo(function VehicleStatusSection({
    isElectric,
    form,
    setForm,
    lastEndBattery,
    hipassCard,
    hipassEnabled = true,
    isEditMode = false,
    isRetroactive = false
}: VehicleStatusSectionProps) {
    // 하이패스 접기/펼치기 상태 (기본값: 접힘 — 자주 사용하지 않는 항목)
    // 훅은 early return 앞에 위치해야 Rules of Hooks를 위반하지 않는다.
    const [isHipassExpanded, setIsHipassExpanded] = useState(() => {
        try {
            const saved = localStorage.getItem('driveLog_hipassExpanded');
            return saved !== null ? JSON.parse(saved) : false;
        } catch {
            return false;
        }
    });

    useEffect(() => {
        localStorage.setItem('driveLog_hipassExpanded', JSON.stringify(isHipassExpanded));
    }, [isHipassExpanded]);

    // 기관 설정에서 하이패스를 끄면 카드가 있어도 하이패스 블록을 숨긴다.
    //
    // 그 일지가 오늘 것이 아니면 숨긴다 — 여기 '현재 잔액'은 그 운행을 하던 날이 아니라
    // 오늘 남은 금액이라, 그 값을 기준으로 사용액을 계산하면 카드 잔액이 엉뚱하게 바뀐다.
    // 과거 일지 수정(isEditMode)과 누락 운행 소급 입력(isRetroactive) 둘 다 해당한다.
    // (submitDriveLog의 shouldApplyHipass가 저장 쪽에서도 같은 경계를 지킨다)
    const showHipass = hipassEnabled && !!hipassCard && !isEditMode && !isRetroactive;

    if (!isElectric && !showHipass) return null;

    return (
        <div className="space-y-5">
            {/* 배터리 (전기차만) */}
            {isElectric && (
                <div className="glass-card p-4">
                    <h3 className="text-sm font-semibold text-surface-700 dark:text-surface-300 mb-3">🔋 배터리</h3>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label htmlFor="batteryStart" className="label text-xs">출발 배터리 %</label>
                            <input
                                id="batteryStart"
                                type="number"
                                min="0" max="100"
                                value={form.batteryStart}
                                onChange={e => setForm({ ...form, batteryStart: stripNegative(e.target.value) })}
                                className="input min-h-[48px]"
                                placeholder={lastEndBattery != null ? `이전 도착: ${lastEndBattery}%` : '80'}
                            />
                        </div>
                        <div>
                            <label htmlFor="batteryEnd" className="label text-xs">도착 배터리 %</label>
                            <input
                                id="batteryEnd"
                                type="number"
                                min="0" max="100"
                                value={form.batteryEnd}
                                onChange={e => setForm({ ...form, batteryEnd: stripNegative(e.target.value) })}
                                className="input min-h-[48px]"
                                placeholder="45"
                            />
                        </div>
                    </div>
                </div>
            )}

            {/* 하이패스 (등록된 차량 + 기관 설정 켜짐) */}
            {showHipass && (
                <div className="glass-card p-4">
                    <div className={`flex items-center justify-between ${isHipassExpanded ? 'mb-3' : ''}`}>
                        <h3 className="text-sm font-semibold text-surface-700 dark:text-surface-300 flex items-center gap-2">
                            💳 하이패스
                            {!isHipassExpanded && form.hipassBalanceAfter !== '' && (
                                <span className="text-xs font-bold text-accent-600 dark:text-accent-400">
                                    잔액 {Number(form.hipassBalanceAfter).toLocaleString()}원
                                </span>
                            )}
                        </h3>
                        <button
                            type="button"
                            onClick={() => setIsHipassExpanded(!isHipassExpanded)}
                            className="text-xs px-3 py-2 min-h-[48px] rounded-md bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-300 hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors flex items-center justify-center font-medium"
                        >
                            {isHipassExpanded ? '닫기 ▲' : '열기 ▼'}
                        </button>
                    </div>
                    {isHipassExpanded && (
                        <>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="label text-xs">사용전 금액</label>
                                    <div className="input bg-surface-100 dark:bg-surface-700 text-surface-500 dark:text-surface-400 cursor-not-allowed" aria-label="하이패스 사용전 금액">
                                        {hipassCard.balance.toLocaleString()}원
                                    </div>
                                </div>
                                <div>
                                    <label htmlFor="hipassAfter" className="label text-xs">사용후 금액</label>
                                    <input
                                        id="hipassAfter"
                                        type="number"
                                        value={form.hipassBalanceAfter}
                                        onChange={e => setForm({ ...form, hipassBalanceAfter: stripNegative(e.target.value) })}
                                        className="input min-h-[48px]"
                                        placeholder={hipassCard.balance.toLocaleString()}
                                        min="0"
                                    />
                                </div>
                            </div>
                            {form.hipassBalanceAfter !== '' && (
                                <div className="mt-3 flex items-center justify-between px-1">
                                    <span className="text-xs text-surface-400 dark:text-surface-500">
                                        사용 금액: <span className="font-bold text-red-500 dark:text-red-400">-{(hipassCard.balance - Number(form.hipassBalanceAfter)).toLocaleString()}원</span>
                                    </span>
                                    <span className={`text-sm font-bold ${
                                        Number(form.hipassBalanceAfter) <= 5000
                                            ? 'text-red-500 dark:text-red-400'
                                            : Number(form.hipassBalanceAfter) <= 20000
                                                ? 'text-amber-500 dark:text-amber-400'
                                                : 'text-accent-600 dark:text-accent-400'
                                    }`}>
                                        잔액: {Number(form.hipassBalanceAfter).toLocaleString()}원
                                    </span>
                                </div>
                            )}
                            <p className="text-xs text-surface-400 dark:text-surface-500 mt-2">하이패스 사용 시 사용후 금액을 입력하면 잔액이 자동으로 업데이트됩니다</p>
                        </>
                    )}
                </div>
            )}
        </div>
    );
});

export default VehicleStatusSection;
