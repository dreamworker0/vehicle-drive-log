/**
 * VehicleManager — 차량 관리 페이지
 * 로직은 useVehicleManager 훅, 폼은 VehicleForm 사용
 */
import { useState } from 'react';
import useVehicleManager from '../../hooks/useVehicleManager';
import VehicleForm from './VehicleForm';
import ConfirmModal from '../common/ConfirmModal';
import CalendarSyncTroubleshootModal from './CalendarSyncTroubleshootModal';
import { VEHICLE_TYPE_ICONS, getVehicleColor } from '../../lib/constants';
import { isVehicleBlocked } from '../../lib/vehicleUtils';
import { SkeletonCard, SkeletonBox } from '../common/Skeleton';
import type { Vehicle } from '../../types/vehicle';

const FUEL_TYPE_LABELS: Record<string, string> = { gasoline: '휘발유', diesel: '경유', lpg: 'LPG', electric: '전기차' };
const FUEL_TYPE_COLORS: Record<string, string> = { gasoline: 'badge-primary', diesel: 'badge-neutral', lpg: 'badge-warning', electric: 'badge-success' };

export default function VehicleManager() {
    const {
        vehicles, loading, showForm, setShowForm,
        editingVehicle, formLoading, form, setForm,
        modal, closeModal, deletableIds,
        openWithCalendarError,
        resetForm, handleEdit, handleModelNameChange, handleSubmit,
        handleCalendarTestResult,
        modelSuggestions,
        openDeleteModal, confirmDelete,
        openClearMaintenanceModal, confirmClearMaintenance,
        openRetireModal, confirmRetire,
        openRestoreModal, confirmRestore,
    } = useVehicleManager();

    // 캘린더 동기화 문제 해결 모달 상태
    const [calendarTroubleshootVehicle, setCalendarTroubleshootVehicle] = useState<Vehicle | null>(null);

    // 활성 차량과 폐차 차량 분리
    const activeVehicles = vehicles.filter(v => !v.retired?.isRetired);
    const retiredVehicles = vehicles.filter(v => v.retired?.isRetired);

    if (loading) {
        return (
            <div className="max-w-4xl mx-auto animate-fade-in">
                <SkeletonBox className="h-7 w-28 mb-1" />
                <SkeletonBox className="h-4 w-20 mb-6" />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <SkeletonCard />
                    <SkeletonCard />
                    <SkeletonCard />
                </div>
            </div>
        );
    }

    // 차량 카드 렌더링 함수
    const renderVehicleCard = (vehicle: Vehicle, isRetired = false) => (
        <div key={vehicle.id} className={`glass-card p-5 transition-all group ${isRetired ? 'opacity-60' : 'hover:shadow-glass-lg'}`}>
            <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                    <div className={`w-12 h-12 ${isRetired ? 'bg-surface-200 dark:bg-surface-700' : getVehicleColor(vehicle.id)} rounded-xl flex items-center justify-center text-2xl ${isRetired ? '' : 'group-hover:scale-110'} transition-transform`}>
                        {isRetired ? '🚫' : (VEHICLE_TYPE_ICONS[vehicle.vehicleType ?? ''] || '🚗')}
                    </div>
                    <div>
                        <div className="flex items-center gap-2">
                            <h3 className={`font-semibold ${isRetired ? 'text-surface-400 line-through' : 'text-surface-900 dark:text-surface-100'}`}>{vehicle.displayName}</h3>
                            {isRetired && (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400">폐차</span>
                            )}
                        </div>
                        <p className="text-sm text-surface-400">{vehicle.modelName}</p>
                    </div>
                </div>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    {isRetired ? (
                        <>
                            <button onClick={() => openRestoreModal(vehicle)} className="btn-icon btn-sm text-green-500 hover:text-green-600" title="복원">
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182" />
                                </svg>
                            </button>
                            <button onClick={() => openDeleteModal(vehicle)} className="btn-icon btn-sm text-surface-400 hover:text-red-500" title="차량 삭제">
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                                </svg>
                            </button>
                        </>
                    ) : (
                        <>
                            <button onClick={() => handleEdit(vehicle)} className="btn-icon btn-sm text-surface-400 hover:text-primary-600">
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Z" />
                                </svg>
                            </button>
                            <button onClick={() => openRetireModal(vehicle)} className="btn-icon btn-sm text-surface-400 hover:text-amber-500" title="폐차">
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 0 0 5.636 5.636m12.728 12.728A9 9 0 0 1 5.636 5.636m12.728 12.728L5.636 5.636" />
                                </svg>
                            </button>
                            {deletableIds.has(vehicle.id) && (
                                <button onClick={() => openDeleteModal(vehicle)} className="btn-icon btn-sm text-surface-400 hover:text-red-500">
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                                    </svg>
                                </button>
                            )}
                        </>
                    )}
                </div>
            </div>
            <div className="flex items-center gap-3 text-sm">
                <span className="text-surface-500 dark:text-surface-400 font-mono">{vehicle.plateNumber}</span>
                <span className={FUEL_TYPE_COLORS[vehicle.fuelType ?? ''] || 'badge-neutral'}>
                    {FUEL_TYPE_LABELS[vehicle.fuelType ?? ''] || vehicle.fuelType || '-'}
                </span>
                <span className="text-surface-400 text-xs ml-auto">
                    {(vehicle.currentKm || 0).toLocaleString()} km
                </span>
            </div>
            {/* 보험 정보 및 캘린더 상태 */}
            {(vehicle.insurance?.company || vehicle.googleCalendarId) && (
                <div className="mt-1.5 flex items-center justify-between gap-2 text-xs text-surface-500 dark:text-surface-400 min-h-[20px]">
                    <div className="flex items-center gap-2">
                        {vehicle.insurance?.company && (
                            <>
                                <span>🛡️ {vehicle.insurance.company}</span>
                                {vehicle.insurance.phone && (
                                    <a href={`tel:${vehicle.insurance.phone}`} className="text-primary-500 hover:underline">{vehicle.insurance.phone}</a>
                                )}
                            </>
                        )}
                    </div>
                    {vehicle.googleCalendarId && (
                        <div className="shrink-0 text-right">
                            {(() => {
                                const failCount = vehicle.calendarSyncFailCount || 0;
                                if (failCount >= 3) {
                                    return (
                                        <span className="px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 font-medium animate-pulse cursor-pointer hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors"
                                            title="클릭하여 캘린더 연동 문제 해결 방법을 확인하세요."
                                            onClick={(e) => { e.stopPropagation(); setCalendarTroubleshootVehicle(vehicle); }}
                                        >
                                            📅 캘린더 동기화 실패 ⚠️
                                        </span>
                                    );
                                }
                                if (failCount >= 1) {
                                    return <span className="px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 font-medium">📅 재시도 중</span>;
                                }
                                return <span className="text-green-600 dark:text-green-400">📅 캘린더 동기화 정상</span>;
                            })()}
                        </div>
                    )}
                </div>
            )}
            {/* 정비 중 / 폐차 사유 표시 */}
            {(vehicle.fuelType === 'electric' || isVehicleBlocked(vehicle.maintenance) || isRetired) && (
                <div className="mt-2 flex items-center gap-3 text-xs text-surface-400">
                    {vehicle.fuelType === 'electric' && vehicle.currentBattery != null && (
                        <span className="flex items-center gap-1">🔋 {vehicle.currentBattery}%</span>
                    )}
                    {isRetired && (
                        <span className="px-2 py-0.5 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded-full font-medium">
                            🚫 {vehicle.retired?.reason || '폐차'}
                        </span>
                    )}
                    {!isRetired && isVehicleBlocked(vehicle.maintenance) && (
                        <div className="flex items-center gap-2 ml-auto">
                            <span className="px-2 py-0.5 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 rounded-full font-medium">
                                🔧 정비 중{vehicle.maintenance?.endDate ? ` ~${vehicle.maintenance.endDate.slice(5)}` : ''}
                            </span>
                            <button
                                onClick={(e) => { e.stopPropagation(); openClearMaintenanceModal(vehicle); }}
                                className="px-2 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded-full font-medium hover:bg-green-200 dark:hover:bg-green-900/50 transition-colors"
                            >
                                ✓ 정비 완료
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );

    // 모달 props 결정
    const getModalProps = () => {
        if (!modal) return { open: false };
        const v = modal.vehicle;
        switch (modal.type) {
            case 'delete':
                return {
                    open: true,
                    title: '차량 삭제',
                    message: `"${v.displayName}" 차량을 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`,
                    confirmText: '삭제',
                    confirmColor: 'danger',
                    onConfirm: confirmDelete,
                    onCancel: closeModal,
                };
            case 'clearMaintenance':
                return {
                    open: true,
                    title: '정비 완료',
                    message: `"${v.displayName}" 차량의 정비를 완료 처리하시겠습니까?\n차량 사용 차단이 해제됩니다.`,
                    confirmText: '완료 처리',
                    onConfirm: confirmClearMaintenance,
                    onCancel: closeModal,
                };
            case 'retire':
                return {
                    open: true,
                    type: 'input',
                    title: '차량 폐차',
                    message: `"${v.displayName}" 차량을 폐차 처리합니다.\n기존 예약이 모두 취소됩니다.`,
                    inputLabel: '폐차 사유',
                    inputPlaceholder: '폐차 사유를 입력하세요',
                    inputDefault: '노후화',
                    confirmText: '폐차 처리',
                    confirmColor: 'warning',
                    onConfirm: confirmRetire,
                    onCancel: closeModal,
                };
            case 'restore':
                return {
                    open: true,
                    title: '차량 복원',
                    message: `"${v.displayName}" 차량을 다시 활성화하시겠습니까?`,
                    confirmText: '복원',
                    onConfirm: confirmRestore,
                    onCancel: closeModal,
                };
            default:
                return { open: false };
        }
    };

    return (
        <div className="max-w-4xl mx-auto animate-fade-in">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
                <div>
                    <h1 className="text-2xl font-bold text-surface-900 dark:text-surface-100">차량 관리</h1>
                    <p className="text-sm text-surface-500 dark:text-surface-400 mt-1">
                        활성 {activeVehicles.length}대{retiredVehicles.length > 0 && ` · 폐차 ${retiredVehicles.length}대`}
                    </p>
                </div>
                <button onClick={() => { resetForm(); setShowForm(true); }} className="btn-primary btn-sm">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                    </svg>
                    차량 등록
                </button>
            </div>

            {showForm && (
            <VehicleForm
                    form={form} setForm={setForm}
                    editingVehicle={editingVehicle}
                    formLoading={formLoading}
                    onSubmit={handleSubmit}
                    onCancel={resetForm}
                    onModelNameChange={handleModelNameChange}
                    modelSuggestions={modelSuggestions}
                    onCalendarTestResult={handleCalendarTestResult}
                    initialCalendarError={openWithCalendarError}
                />
            )}

            {activeVehicles.length === 0 && retiredVehicles.length === 0 ? (
                <div className="glass-card p-12 text-center">
                    <svg className="w-16 h-16 mx-auto text-surface-200 mb-4" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 0 1-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 0 0-3.213-9.193 2.056 2.056 0 0 0-1.58-.86H14.25M16.5 18.75h-2.25m0-11.177v-.958c0-.568-.422-1.048-.987-1.106a48.554 48.554 0 0 0-10.026 0 1.106 1.106 0 0 0-.987 1.106v7.635m12-6.677v6.677m0 4.5v-4.5m0 0h-12" />
                    </svg>
                    <p className="text-surface-400 text-lg font-medium">등록된 차량이 없습니다</p>
                    <p className="text-sm text-surface-300 mt-1">차량을 등록하고 운행 관리를 시작하세요</p>
                </div>
            ) : (
                <>
                    {/* 활성 차량 */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {activeVehicles.map(vehicle => renderVehicleCard(vehicle, false))}
                    </div>

                    {/* 폐차 차량 */}
                    {retiredVehicles.length > 0 && (
                        <div className="mt-8">
                            <h2 className="text-sm font-medium text-surface-400 dark:text-surface-500 mb-3 flex items-center gap-2">
                                <span>🚫 폐차된 차량</span>
                                <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-surface-200 dark:bg-surface-700 text-surface-500">{retiredVehicles.length}</span>
                            </h2>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                {retiredVehicles.map(vehicle => renderVehicleCard(vehicle, true))}
                            </div>
                        </div>
                    )}
                </>
            )}

            {/* 통합 확인/입력 모달 */}
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            <ConfirmModal {...getModalProps() as any} />

            {/* 캘린더 동기화 문제 해결 모달 */}
            {calendarTroubleshootVehicle && (
                <CalendarSyncTroubleshootModal
                    vehicle={calendarTroubleshootVehicle}
                    onClose={() => setCalendarTroubleshootVehicle(null)}
                    onGoToEdit={(v) => { setCalendarTroubleshootVehicle(null); handleEdit(v, false); }}
                    onCalendarTestResult={handleCalendarTestResult}
                />
            )}
        </div>
    );
}
