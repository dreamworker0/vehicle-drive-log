/**
 * VehicleForm — 차량 등록/수정 모달 폼
 * VehicleManager에서 추출된 서브 컴포넌트
 */
import React from 'react';
import { DEFAULT_FUEL } from '../../hooks/useVehicleManager';
import type { Vehicle } from '../../types';

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
}

interface Props {
    form: VehicleFormData;
    setForm: React.Dispatch<React.SetStateAction<VehicleFormData>>;
    editingVehicle: Vehicle | null;
    formLoading: boolean;
    onSubmit: (e: React.FormEvent) => void;
    onCancel: () => void;
    onModelNameChange: (value: string) => void;
}

const VEHICLE_TYPES = [
    { value: 'compact', label: '경차', icon: '🚙' },
    { value: 'sedan', label: '승용차', icon: '🚗' },
    { value: 'van', label: '승합차', icon: '🚐' },
    { value: 'truck', label: '화물차', icon: '🚚' },
    { value: 'bus', label: '버스', icon: '🚌' },
];

const FUEL_TYPES = [
    { value: 'gasoline', label: '휘발유', icon: '⛽' },
    { value: 'diesel', label: '경유', icon: '🟤' },
    { value: 'lpg', label: 'LPG', icon: '🔵' },
    { value: 'electric', label: '전기차', icon: '⚡' },
];

export default function VehicleForm({
    form, setForm, editingVehicle, formLoading,
    onSubmit, onCancel, onModelNameChange,
}: Props) {
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
                        className="p-1.5 rounded-lg text-surface-400 hover:text-surface-600 hover:bg-surface-100 dark:hover:text-surface-300 dark:hover:bg-surface-700 transition-colors"
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
                            className="input" placeholder="예: 소나타2744" required autoFocus
                        />
                        <p className="text-xs text-surface-400 mt-1">직원들이 쉽게 구분할 수 있는 이름</p>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="label">모델명</label>
                            <input
                                type="text" value={form.modelName}
                                onChange={e => onModelNameChange(e.target.value)}
                                className="input" placeholder="소나타"
                            />
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
                                    onClick={() => setForm({ ...form, vehicleType: vt.value, fuelType: DEFAULT_FUEL[vt.value] || form.fuelType })}
                                    className={`flex flex-col items-center gap-1 px-2 py-3 rounded-xl text-xs font-medium border transition-all ${form.vehicleType === vt.value
                                        ? 'border-primary-500 bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300 dark:border-primary-400'
                                        : 'border-surface-200 dark:border-surface-600 text-surface-500 dark:text-surface-400 hover:border-surface-300'
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
                                    key={ft.value} type="button"
                                    onClick={() => setForm({ ...form, fuelType: ft.value })}
                                    className={`px-3 py-2.5 rounded-xl text-sm font-medium border transition-all ${form.fuelType === ft.value
                                        ? 'border-primary-500 bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300 dark:border-primary-400'
                                        : 'border-surface-200 dark:border-surface-600 text-surface-500 dark:text-surface-400 hover:border-surface-300'
                                        }`}
                                >
                                    {ft.icon} {ft.label}
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
                        <p className="text-xs text-surface-400 mt-1">차량 등록 시점의 누적 주행거리</p>
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
                        <p className="text-xs text-surface-400 mt-1">사고 시 연락할 보험사 정보</p>
                    </div>

                    <div>
                        <label className="label">Google 캘린더 ID (선택)</label>
                        <input
                            type="text" value={form.googleCalendarId}
                            onChange={e => setForm({ ...form, googleCalendarId: e.target.value })}
                            className="input" placeholder="calendar-resource-id@resource.calendar.google.com"
                        />
                        <details className="mt-2 text-xs text-surface-500 dark:text-surface-400">
                            <summary className="cursor-pointer text-primary-600 dark:text-primary-400 hover:underline font-medium">
                                📋 설정 방법 안내
                            </summary>
                            <div className="mt-2 p-3 rounded-lg bg-surface-50 dark:bg-surface-800 space-y-2 border border-surface-200 dark:border-surface-700">
                                <p className="font-medium text-surface-700 dark:text-surface-300">구글 캘린더 동기화 설정 방법:</p>
                                <ol className="list-decimal list-inside space-y-1.5 text-surface-600 dark:text-surface-400">
                                    <li>구글 캘린더에서 공유할 캘린더의 <strong className="text-surface-700 dark:text-surface-300">설정 및 공유</strong>로 이동</li>
                                    <li><strong className="text-surface-700 dark:text-surface-300">공유 대상</strong>에서 <strong className="text-surface-700 dark:text-surface-300">+ 사용자 및 그룹 추가</strong>를 클릭하고, 아래 이메일을 <strong className="text-surface-700 dark:text-surface-300">"일정 변경"</strong> 권한으로 추가</li>
                                    <li><strong className="text-surface-700 dark:text-surface-300">캘린더 통합</strong> 섹션에서 캘린더 ID를 복사하여 위 입력란에 붙여넣기</li>
                                </ol>
                                <div className="mt-3 p-2.5 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
                                    <p className="font-medium text-amber-700 dark:text-amber-400 mb-1.5">⚠️ Google Workspace(업무 계정) 사용 시</p>
                                    <p className="text-surface-600 dark:text-surface-400 mb-1">관리 콘솔에서 캘린더 외부 공유를 허용해야 합니다:</p>
                                    <ol className="list-decimal list-inside space-y-1 text-surface-600 dark:text-surface-400 ml-1">
                                        <li><strong className="text-surface-700 dark:text-surface-300">Google 관리 콘솔</strong> → 앱 → Google Workspace → Calendar 설정 → <strong className="text-surface-700 dark:text-surface-300">일반 설정</strong></li>
                                        <li><strong className="text-surface-700 dark:text-surface-300">보조 캘린더의 외부 공유 옵션</strong>에서 <strong className="text-surface-700 dark:text-surface-300">"모든 정보를 공유하며 외부 사용자도 캘린더를 변경할 수 있음"</strong> 선택</li>
                                        <li>오른쪽 하단의 <strong className="text-surface-700 dark:text-surface-300">[저장]</strong> 클릭</li>
                                    </ol>
                                </div>
                                <div className="mt-2 flex items-center gap-2">
                                    <code className="flex-1 px-2 py-1.5 rounded bg-surface-100 dark:bg-surface-900 text-[11px] font-mono text-surface-700 dark:text-surface-300 select-all break-all">
                                        1066541065552-compute@developer.gserviceaccount.com
                                    </code>
                                    <button
                                        type="button"
                                        onClick={(e) => {
                                            navigator.clipboard.writeText('1066541065552-compute@developer.gserviceaccount.com');
                                            const btn = e.currentTarget;
                                            btn.textContent = '✓';
                                            setTimeout(() => { btn.textContent = '복사'; }, 1500);
                                        }}
                                        className="shrink-0 px-2 py-1.5 text-[11px] rounded bg-primary-500 text-white hover:bg-primary-600 transition-colors"
                                    >복사</button>
                                </div>
                                <p className="text-[11px] text-surface-400 dark:text-surface-500 mt-1">
                                    💡 기관 내 모든 차량에 같은 캘린더 ID를 사용하면 통합 관리가 편리합니다
                                </p>
                            </div>
                        </details>
                    </div>
                    <div className="flex gap-3 pt-2">
                        <button type="button" onClick={onCancel} className="btn-secondary flex-1">취소</button>
                        <button type="submit" disabled={formLoading} className="btn-primary flex-1">
                            {formLoading ? (<><div className="w-4 h-4 spinner" />저장 중...</>) : editingVehicle ? '수정' : '등록'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
