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

export default function VehicleForm({
    form, setForm, editingVehicle, formLoading,
    onSubmit, onCancel, onModelNameChange, modelSuggestions,
    members, onCalendarTestResult, initialCalendarError,
}: Props) {
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
                    <div>
                        <label className="label">현재 누적 km</label>
                        <input
                            type="number" value={form.currentKm}
                            onChange={e => setForm({ ...form, currentKm: e.target.value })}
                            className="input" placeholder="0"
                        />
                        <p className="text-xs text-surface-400 dark:text-surface-500 mt-1">차량 등록 시점의 누적 주행거리</p>
                    </div>
                    <div>
                        <label className="label">보험 정보</label>
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
                    </div>

                    <div>
                        <label className="label">🔒 사용 가능 직원 (선택)</label>
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
                    </div>

                    <VehicleCalendarSection
                        calendarId={form.googleCalendarId}
                        onChange={value => setForm({ ...form, googleCalendarId: value })}
                        editingVehicle={editingVehicle}
                        onCalendarTestResult={onCalendarTestResult}
                        initialCalendarError={initialCalendarError}
                    />
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
