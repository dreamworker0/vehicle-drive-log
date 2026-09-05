/**
 * VehicleForm — 차량 등록/수정 모달 폼
 * VehicleManager에서 추출된 서브 컴포넌트
 */
import React, { useState, useRef, useEffect } from 'react';
import { DEFAULT_FUEL } from '../../hooks/useVehicleManager';
import type { Vehicle } from '../../types';
import type { User } from '../../types/user';
import { FUEL_TYPES } from '../../types/vehicle';
import VehicleCalendarSection from './VehicleCalendarSection';
import { useAuth } from '../../hooks/useAuth';
import { hasBranchSites, MAIN_SITE_ID } from '../../lib/orgSites';
import Toggle from '../common/Toggle';
import { stripNegative } from '../../hooks/utils/numberValidation';

interface VehicleFormData {
    displayName: string;
    modelName: string;
    plateNumber: string;
    vehicleType: string;
    fuelType: string;
    currentKm: string;
    googleCalendarId: string;
    insuranceCompany: string;
    insurancePhone: string;
    insuranceExpiryDate: string;
    allowedUserIds: string[];
    /** 기본 차고지 id. 빈 값 = 본관 */
    siteId: string;
    /** 출발지가 매번 바뀌는 차량인가. 켜야 운전자용 출발지 선택이 열린다. */
    siteVaries: boolean;
    /** 지금 실제로 서 있는 곳. 운행 기록으로 자동 갱신되며, 유동 차량에만 노출된다. */
    currentSiteId: string;
    /** 주유(충전)가 필요한가. 운행일지·주유일지로 자동 갱신되며, 여기서는 보정만 한다. */
    needsRefuel: boolean;
}

interface Props {
    form: VehicleFormData;
    setForm: React.Dispatch<React.SetStateAction<VehicleFormData>>;
    editingVehicle: Vehicle | null;
    formLoading: boolean;
    onSubmit: (e: React.FormEvent) => void;
    onCancel: () => void;
    onModelNameChange: (value: string) => void;
    modelSuggestions: string[];
    members: User[];
    onCalendarTestResult?: (vehicleId: string, success: boolean) => Promise<void>;
    initialCalendarError?: boolean;
}

const VEHICLE_TYPES = [
    { value: 'compact', label: '경차', icon: '🚙' },
    { value: 'sedan', label: '승용차', icon: '🚗' },
    { value: 'van', label: '승합차', icon: '🚐' },
    { value: 'truck', label: '화물차', icon: '🚚' },
    { value: 'bus', label: '버스', icon: '🚌' },
];

/** 선택 입력 섹션 접기/펼치기 래퍼 — 접힌 상태에서도 summary로 입력 여부를 보여준다 */
function CollapsibleSection({ title, summary, defaultOpen = false, children }: {
    title: string;
    summary?: string;
    defaultOpen?: boolean;
    children: React.ReactNode;
}) {
    const [open, setOpen] = useState(defaultOpen);
    return (
        <div className="border border-surface-200 dark:border-surface-700 rounded-xl overflow-hidden">
            <button
                type="button"
                onClick={() => setOpen(o => !o)}
                aria-expanded={open}
                className="w-full flex items-center justify-between gap-2 px-3 py-2.5 min-h-[48px] text-left bg-surface-50 dark:bg-surface-800 hover:bg-surface-100 dark:hover:bg-surface-700 transition-colors"
            >
                <span className="text-sm font-medium text-surface-700 dark:text-surface-300">{title}</span>
                <span className="flex items-center gap-2 min-w-0">
                    {summary && <span className="text-xs text-surface-400 dark:text-surface-500 truncate">{summary}</span>}
                    <svg className={`w-4 h-4 shrink-0 text-surface-400 dark:text-surface-500 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="m19 9-7 7-7-7" />
                    </svg>
                </span>
            </button>
            {open && <div className="p-3">{children}</div>}
        </div>
    );
}

export default function VehicleForm({
    form, setForm, editingVehicle, formLoading,
    onSubmit, onCancel, onModelNameChange, modelSuggestions,
    members, onCalendarTestResult, initialCalendarError,
}: Props) {
    const { orgFeatures, orgSites } = useAuth();
    // 분관을 등록하지 않은 기관에는 고를 것이 없다 — 선택지 하나짜리 UI를 띄우지 않는다.
    const showSiteSelect = hasBranchSites(orgSites);
    // 전기·수소차는 '주유'가 아니라 '충전'이다 (운전자 화면과 같은 규칙).
    const refuelWord = form.fuelType === 'electric' || form.fuelType === 'hydrogen' ? '충전' : '주유';
    const toggleAllowedUser = (uid: string) => {
        setForm(prev => ({
            ...prev,
            allowedUserIds: prev.allowedUserIds.includes(uid)
                ? prev.allowedUserIds.filter(id => id !== uid)
                : [...prev.allowedUserIds, uid],
        }));
    };
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [activeIndex, setActiveIndex] = useState(-1);
    const modelInputRef = useRef<HTMLInputElement>(null);
    const suggestionsRef = useRef<HTMLUListElement>(null);

    // 필터링된 후보 목록
    const filtered = form.modelName.trim()
        ? modelSuggestions.filter(s =>
            s.toLowerCase().includes(form.modelName.trim().toLowerCase())
          )
        : modelSuggestions;

    // 드롭다운 외부 클릭 시 닫기
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (
                modelInputRef.current && !modelInputRef.current.contains(e.target as Node) &&
                suggestionsRef.current && !suggestionsRef.current.contains(e.target as Node)
            ) {
                setShowSuggestions(false);
                setActiveIndex(-1);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    const selectSuggestion = (value: string) => {
        onModelNameChange(value);
        setShowSuggestions(false);
        setActiveIndex(-1);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (!showSuggestions || filtered.length === 0) return;
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActiveIndex(i => Math.min(i + 1, filtered.length - 1));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActiveIndex(i => Math.max(i - 1, 0));
        } else if (e.key === 'Enter' && activeIndex >= 0) {
            e.preventDefault();
            selectSuggestion(filtered[activeIndex]);
        } else if (e.key === 'Escape') {
            setShowSuggestions(false);
            setActiveIndex(-1);
        }
    };
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
            <div className="glass-card p-6 w-full max-w-md max-h-[90vh] overflow-y-auto animate-scale-in">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-surface-900 dark:text-surface-100">
                        {editingVehicle ? '차량 수정' : '차량 등록'}
                    </h3>
                    <button
                        type="button"
                        onClick={onCancel}
                        className="p-1.5 rounded-lg text-surface-400 hover:text-surface-600 hover:bg-surface-100 dark:hover:text-surface-300 dark:hover:bg-surface-700 transition-colors min-h-[48px]"
                        aria-label="닫기"
                    >
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>
                <form onSubmit={onSubmit} className="space-y-4">
                    <div>
                        <label className="label">표시 이름 <span className="text-red-500">*</span></label>
                        <input
                            type="text" value={form.displayName}
                            onChange={e => setForm({ ...form, displayName: e.target.value })}
                            className="input" placeholder="예: 소나타2744" required
                        />
                        <p className="text-xs text-surface-400 dark:text-surface-500 mt-1">직원들이 쉽게 구분할 수 있는 이름</p>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                    <div>
                            <label className="label">모델명 <span className="text-red-500">*</span></label>
                            <div className="relative">
                                <input
                                    ref={modelInputRef}
                                    type="text"
                                    value={form.modelName}
                                    onChange={e => {
                                        onModelNameChange(e.target.value);
                                        setShowSuggestions(true);
                                        setActiveIndex(-1);
                                    }}
                                    onFocus={() => setShowSuggestions(true)}
                                    onKeyDown={handleKeyDown}
                                    className="input pr-8"
                                    placeholder="소나타"
                                    autoComplete="off"
                                    required
                                />
                                {/* 화살표 아이콘 */}
                                <svg
                                    className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-400 dark:text-surface-500 pointer-events-none"
                                    fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"
                                >
                                    <path strokeLinecap="round" strokeLinejoin="round" d="m19 9-7 7-7-7" />
                                </svg>
                                {/* 자동완성 드롭다운 */}
                                {showSuggestions && filtered.length > 0 && (
                                    <ul
                                        ref={suggestionsRef}
                                        className="absolute z-50 w-full mt-1 bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-600 rounded-xl shadow-lg max-h-48 overflow-y-auto"
                                    >
                                        {filtered.map((s, i) => (
                                            <li
                                                key={s}
                                                role="option"
                                                aria-selected={i === activeIndex}
                                                tabIndex={0}
                                                onMouseDown={() => selectSuggestion(s)}
                                                onKeyDown={(e) => { if (e.key === 'Enter') selectSuggestion(s); }}
                                                className={`px-3 py-2 cursor-pointer text-sm transition-colors
                                                    ${i === activeIndex
                                                        ? 'bg-primary-50 dark:bg-primary-900/40 text-primary-700 dark:text-primary-300'
                                                        : 'text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-700'
                                                    }`}
                                            >
                                                {s}
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                        </div>
                        <div>
                            <label className="label">차량번호 <span className="text-red-500">*</span></label>
                            <input
                                type="text" value={form.plateNumber}
                                onChange={e => setForm({ ...form, plateNumber: e.target.value })}
                                className="input" placeholder="12가 3456" required
                            />
                        </div>
                    </div>
                    <div>
                        <label className="label">차종</label>
                        <div className="grid grid-cols-5 gap-2">
                            {VEHICLE_TYPES.map(vt => (
                                <button
                                    key={vt.value} type="button"
                                    onClick={() => {
                                        const keepFuel = form.fuelType === 'electric' || form.fuelType === 'hydrogen';
                                        setForm({
                                            ...form,
                                            vehicleType: vt.value,
                                            fuelType: keepFuel ? form.fuelType : (DEFAULT_FUEL[vt.value] || form.fuelType)
                                        });
                                    }}
                                    className={`flex flex-col items-center gap-1 px-2 py-3 rounded-xl text-xs font-medium border transition-all ${form.vehicleType === vt.value
                                        ? 'border-primary-500 bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300 dark:border-primary-400'
                                        : 'border-surface-200 dark:border-surface-600 text-surface-500 dark:text-surface-400 hover:border-surface-300 dark:hover:border-surface-500'
                                        }`}
                                >
                                    <span className="text-2xl">{vt.icon}</span>
                                    {vt.label}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div>
                        <label className="label">연료 유형</label>
                        <div className="grid grid-cols-2 gap-2">
                            {FUEL_TYPES.map(ft => (
                                <button
                                    key={ft.id} type="button"
                                    onClick={() => setForm({ ...form, fuelType: ft.id })}
                                    className={`px-3 py-2.5 rounded-xl text-sm font-medium border transition-all ${form.fuelType === ft.id
                                        ? 'border-primary-500 bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300 dark:border-primary-400'
                                        : 'border-surface-200 dark:border-surface-600 text-surface-500 dark:text-surface-400 hover:border-surface-300 dark:hover:border-surface-500'
                                        }`}
                                >
                                    {ft.label}
                                </button>
                            ))}
                        </div>
                    </div>
                    {showSiteSelect && (
                    <div>
                        <label className="label">기본 차고지</label>
                        <div className="grid grid-cols-2 gap-2">
                            {orgSites.map(site => {
                                const selected = (form.siteId || MAIN_SITE_ID) === site.id;
                                return (
                                    <button
                                        key={site.id} type="button"
                                        onClick={() => setForm({ ...form, siteId: site.id === MAIN_SITE_ID ? '' : site.id })}
                                        className={`px-3 py-2.5 min-h-[48px] rounded-xl text-sm font-medium border transition-all ${selected
                                            ? 'border-primary-500 bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300 dark:border-primary-400'
                                            : 'border-surface-200 dark:border-surface-600 text-surface-500 dark:text-surface-400 hover:border-surface-300 dark:hover:border-surface-500'
                                            }`}
                                    >
                                        {site.name}
                                    </button>
                                );
                            })}
                        </div>
                        <p className="text-xs text-surface-400 dark:text-surface-500 mt-1">
                            평소 이 차량이 세워져 있는 곳 · 예약의 거리와 소요시간이 이 주소에서 출발하는 기준으로 계산됩니다
                        </p>
                    </div>
                    )}
                    {showSiteSelect && (
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                            <p className="label mb-0.5">출발지가 매번 바뀜</p>
                            <p className="text-xs text-surface-400 dark:text-surface-500">
                                켜면 운전자가 운행일지에서 출발지와 차를 세운 곳을 직접 고릅니다 · 24시간 운영처럼 차가 매일 다른 곳에서 출발할 때만 켜세요
                            </p>
                        </div>
                        <div className="flex-shrink-0 pt-1">
                            <Toggle
                                checked={form.siteVaries}
                                onChange={next => setForm(prev => ({
                                    // 끄면 현재 위치도 함께 비운다 — 남겨 두면 나중에 다시 켰을 때
                                    // 몇 달 전 위치가 되살아나 사람을 엉뚱한 곳으로 보낸다.
                                    ...prev, siteVaries: next, ...(next ? {} : { currentSiteId: '' }),
                                }))}
                                label="출발지가 매번 바뀜"
                            />
                        </div>
                    </div>
                    )}
                    {showSiteSelect && form.siteVaries && (
                    <div data-testid="vehicle-current-site">
                        <label className="label">현재 위치</label>
                        <select
                            value={form.currentSiteId || MAIN_SITE_ID}
                            onChange={e => setForm({ ...form, currentSiteId: e.target.value })}
                            className="input"
                            aria-label="현재 위치"
                        >
                            {orgSites.map(site => (
                                <option key={site.id} value={site.id}>{site.name}</option>
                            ))}
                        </select>
                        <p className="text-xs text-surface-400 dark:text-surface-500 mt-1">
                            운행 기록으로 자동 갱신됩니다 · 기록 없이 차를 옮겼을 때만 직접 고치세요
                        </p>
                    </div>
                    )}
                    {orgFeatures.refuelFlag && (
                    <div className="flex items-start justify-between gap-3" data-testid="vehicle-needs-refuel">
                        <div className="min-w-0">
                            <label className="label mb-0">{refuelWord} 필요</label>
                            <p className="text-xs text-surface-400 dark:text-surface-500 mt-1">
                                운전자가 운행일지에서 켜고 {refuelWord}일지를 쓰면 자동으로 꺼집니다 ·
                                {refuelWord}일지를 쓰지 않는다면 여기서 직접 끄세요
                            </p>
                        </div>
                        <div className="flex-shrink-0 pt-1">
                            <Toggle
                                checked={form.needsRefuel}
                                onChange={next => setForm(prev => ({ ...prev, needsRefuel: next }))}
                                label={`${refuelWord} 필요`}
                                onClassName="bg-amber-500"
                            />
                        </div>
                    </div>
                    )}
                    <div>
                        <label className="label">현재 누적 km</label>
                        <input
                            type="number" min={0} value={form.currentKm}
                            onChange={e => setForm({ ...form, currentKm: stripNegative(e.target.value) })}
                            className="input" placeholder="0"
                        />
                        {form.currentKm !== '' && Number(form.currentKm) < 0 && (
                            <p className="text-[11px] text-red-500 dark:text-red-400 mt-1 font-medium">⚠️ 누적 km는 0 이상이어야 합니다.</p>
                        )}
                        <p className="text-xs text-surface-400 dark:text-surface-500 mt-1">차량 등록 시점의 누적 주행거리</p>
                    </div>
                    <CollapsibleSection
                        title="🛡️ 보험 정보 (선택)"
                        summary={form.insuranceCompany.trim() || (form.insuranceExpiryDate ? `만료 ${form.insuranceExpiryDate}` : '미입력')}
                    >
                        <div className="grid grid-cols-2 gap-3">
                            <input
                                type="text" value={form.insuranceCompany}
                                onChange={e => setForm({ ...form, insuranceCompany: e.target.value })}
                                className="input" placeholder="보험사명"
                            />
                            <input
                                type="tel" value={form.insurancePhone}
                                onChange={e => setForm({ ...form, insurancePhone: e.target.value })}
                                className="input" placeholder="전화번호"
                            />
                        </div>
                        <label htmlFor="insurance-expiry-date" className="label mt-3">보험 만료일</label>
                        <input
                            id="insurance-expiry-date"
                            type="date" value={form.insuranceExpiryDate}
                            onChange={e => setForm({ ...form, insuranceExpiryDate: e.target.value })}
                            className="input" aria-describedby="insurance-info-help"
                        />
                        <p id="insurance-info-help" className="text-xs text-surface-400 dark:text-surface-500 mt-1">
                            사고 시 연락할 보험사 정보 · 만료 15일 전 관리자에게 알림
                        </p>
                    </CollapsibleSection>

                    {orgFeatures.allowedUsers && (
                    <CollapsibleSection
                        title="🔒 사용 가능 직원 (선택)"
                        summary={form.allowedUserIds.length > 0 ? `${form.allowedUserIds.length}명 지정` : '전체 허용'}
                    >
                        {members.length > 0 ? (
                            <div className="flex flex-wrap gap-1.5">
                                {members.map(m => {
                                    const isSelected = form.allowedUserIds.includes(m.id);
                                    return (
                                        <button
                                            key={m.id}
                                            type="button"
                                            onClick={() => toggleAllowedUser(m.id)}
                                            className={`px-4 py-2 min-h-[48px] rounded-full text-xs font-medium border transition-all ${isSelected
                                                ? 'bg-primary-100 dark:bg-primary-900/40 border-primary-300 text-primary-700 dark:text-primary-300 ring-1 ring-primary-200 dark:ring-primary-900/40'
                                                : 'bg-surface-50 dark:bg-surface-800 border-surface-200 dark:border-surface-600 text-surface-600 dark:text-surface-400 hover:border-primary-300 dark:hover:border-primary-700'
                                                }`}
                                        >
                                            {isSelected && '✓ '}{m.name || m.email?.split('@')[0]}
                                        </button>
                                    );
                                })}
                            </div>
                        ) : (
                            <p className="text-xs text-surface-400 dark:text-surface-500">직원 목록을 불러오는 중이거나 등록된 직원이 없습니다</p>
                        )}
                        <p className="text-xs text-surface-400 dark:text-surface-500 mt-1.5">
                            선택하지 않으면 모든 직원이 사용할 수 있습니다 · 선택하면 지정된 직원만(관리자 포함 그 외 전원 불가) 예약·운행 가능
                        </p>
                    </CollapsibleSection>
                    )}

                    {orgFeatures.googleCalendar && (
                    <CollapsibleSection
                        title="📅 Google 캘린더 (선택)"
                        summary={(editingVehicle?.calendarSyncFailCount ?? 0) >= 3 ? '⚠️ 동기화 실패' : form.googleCalendarId.trim() ? '연동됨' : '미연동'}
                        defaultOpen={initialCalendarError}
                    >
                        <VehicleCalendarSection
                            calendarId={form.googleCalendarId}
                            onChange={value => setForm({ ...form, googleCalendarId: value })}
                            editingVehicle={editingVehicle}
                            onCalendarTestResult={onCalendarTestResult}
                            initialCalendarError={initialCalendarError}
                        />
                    </CollapsibleSection>
                    )}
                    <div className="flex gap-3 pt-2">
                        <button type="button" onClick={onCancel} className="btn-secondary flex-1 min-h-[48px]">취소</button>
                        <button type="submit" disabled={formLoading} className="btn-primary flex-1 min-h-[48px]">
                            {formLoading ? (<><div className="w-4 h-4 spinner" />저장 중...</>) : editingVehicle ? '수정' : '등록'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
