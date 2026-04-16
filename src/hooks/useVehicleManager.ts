/**
 * useVehicleManager — 차량 관리 상태 + CRUD 로직
 * VehicleManager에서 추출된 커스텀 훅
 */
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from './useAuth';
import type { Vehicle, FuelType } from '../types/vehicle';
import useRetry from './useRetry';

interface VehicleModal {
    type: 'delete' | 'clearMaintenance' | 'retire' | 'restore';
    vehicle: Vehicle;
}
import { getVehicles, createVehicle, updateVehicle, deleteVehicle, hasVehicleDriveLogs, clearVehicleMaintenanceBlock, retireVehicle, restoreVehicle, cancelVehicleReservations } from '../lib/firestore';
import { useToast } from './useToast';
import { captureError } from '../lib/sentry';

// 전기차 모델명 목록 (감지 시 fuelType을 electric으로 자동 설정)
const ELECTRIC_MODELS = [
    '아이오닉', '아이오닉5', '아이오닉6', '아이오닉7',
    'EV3', 'EV5', 'EV6', 'EV9', '니로EV', '니로 EV', '코나EV', '코나 EV', '코나 일렉트릭',
    '볼트EV', '볼트 EV', '볼트EUV',
    '테슬라', 'Model 3', 'Model Y', 'Model S', 'Model X',
    'e-트론', 'ID.4', '폴스타', '제로', 'i4', 'iX',
    'SM3 Z.E', 'ZOE', '트위지',
    '포터EV', '포터 EV', '봉고EV', '봉고 EV',
];

// 수소차 모델명 목록
const HYDROGEN_MODELS = ['넥쏘', 'nexo'];

// 모델명 → 차종 자동 매핑
const MODEL_TYPE_MAP = {
    compact: ['모닝', '캐스퍼', '마티즈', '레이', '스파크', '다마스', '티코', '트위즈', '피카퇠', 'ZOE', '트위지'],
    sedan: [
        '소나타', '아반떼', '그랜저', 'K5', 'K3', 'K7', 'K8', 'K9', '말리부', '셀토스', '제네시스', 'SM6', 'SM3', '투슨', 'i30', 'i40',
        '아이오닉', 'EV3', 'EV5', 'EV6', 'EV9', '니로', '코나', '볼트',
        '테슬라', 'Model 3', 'Model Y', 'Model S', 'Model X',
        'e-트론', 'ID.4', '폴스타', '제로', 'i4', 'iX',
        '넥쏘', 'nexo'
    ],
    van: ['스타렉스', '스타랙스', '스타리아', '스타리야', '카니발', '카니벌', '콴라티', '보나식', '투산', '마스터', '보고', '싶온', '라바'],
    bus: ['유니버스', '에어로', '카운티', '카운디', '레스타', '솔라티', '솔라디', '시티', '그린시티'],
    truck: ['포터', '봉고', '봉구', '마이티', '메가트럭', '노부스', '파비스', '더카고', '그랜버드'],
};

// 모델명이 전기차인지 판별
const isElectricModel = (modelName: string) => {
    const name = modelName.trim().toLowerCase();
    if (!name) return false;
    return ELECTRIC_MODELS.some(m => name.includes(m.toLowerCase()));
};

// 모델명이 수소차인지 판별
const isHydrogenModel = (modelName: string) => {
    const name = modelName.trim().toLowerCase();
    if (!name) return false;
    return HYDROGEN_MODELS.some(m => name.includes(m.toLowerCase()));
};

// 연료 타입 판별 유틸
export const isChargeableFuel = (fuel?: string | null) => fuel === 'electric' || fuel === 'hydrogen';

const guessVehicleType = (modelName: string): string | null => {
    const name = modelName.trim().toLowerCase();
    if (!name) return null;
    for (const [type, models] of Object.entries(MODEL_TYPE_MAP)) {
        if (models.some(m => name.includes(m.toLowerCase()))) return type;
    }
    return null;
};

// 차종별 기본 연료 유형
export const DEFAULT_FUEL: Record<string, FuelType> = { compact: 'gasoline', sedan: 'gasoline', van: 'diesel', bus: 'diesel', truck: 'diesel' };

const INITIAL_FORM = {
    displayName: '', modelName: '', plateNumber: '',
    vehicleType: 'sedan', fuelType: 'gasoline',
    currentKm: '', googleCalendarId: '',
    insuranceCompany: '', insurancePhone: '',
};

export default function useVehicleManager() {
    const { userData } = useAuth();
    const { showToast } = useToast();
    const { runWithRetry } = useRetry();
    const [vehicles, setVehicles] = useState<Vehicle[]>([]);
    const [loading, setLoading] = useState(true);
    const [deletableIds, setDeletableIds] = useState<Set<string>>(new Set());
    const [showForm, setShowForm] = useState(false);
    const [editingVehicle, setEditingVehicle] = useState<Vehicle | null>(null);
    const [formLoading, setFormLoading] = useState(false);
    const [form, setForm] = useState(INITIAL_FORM);

    // 모달 상태 — { type, vehicle, action } 형태로 관리
    const [modal, setModal] = useState<VehicleModal | null>(null);

    const orgId = userData?.organizationId;

    const fetchVehicles = async (retryCount = 0) => {
        if (!orgId) { setLoading(false); return; }
        setLoading(true);
        try {
            const data = await getVehicles(orgId);
            setVehicles(data);
            // 각 차량의 운행일지 존재 여부 병렬 체크
            const checks = await Promise.all(
                data.map(async (v) => {
                    const has = await hasVehicleDriveLogs(v.id);
                    return { id: v.id, has };
                })
            );
            setDeletableIds(new Set(checks.filter(c => !c.has).map(c => c.id)));
        } catch (err) {
            const errCode = (err as { code?: string })?.code;
            // Custom Claims가 아직 토큰에 반영되지 않아 권한 거부된 경우 1회 재시도
            if (errCode === 'permission-denied' && retryCount < 1) {
                console.debug('Custom Claims 미반영 — 토큰 갱신 후 재시도');
                try {
                    const { auth: firebaseAuth } = await import('../lib/firebase');
                    const { refreshTokenSilently } = await import('../lib/tokenRefresh');
                    if (firebaseAuth.currentUser) {
                        await refreshTokenSilently(firebaseAuth.currentUser);
                    }
                } catch { /* ignore */ }
                setTimeout(() => fetchVehicles(retryCount + 1), 800);
                return;
            }
            console.error('차량 목록 로드 실패:', err);
            captureError(err, { context: 'fetchVehicles', orgId, retryCount });
        } finally {
            setLoading(false);
        }
    };

    /* eslint-disable react-hooks/exhaustive-deps */
    useEffect(() => { fetchVehicles(); }, [orgId]);
    /* eslint-enable react-hooks/exhaustive-deps */

    const resetForm = () => {
        setForm(INITIAL_FORM);
        setEditingVehicle(null);
        setShowForm(false);
    };

    const handleEdit = (vehicle: Vehicle) => {
        setForm({
            displayName: vehicle.displayName || '',
            modelName: vehicle.modelName || '',
            plateNumber: vehicle.plateNumber || '',
            vehicleType: vehicle.vehicleType || 'sedan',
            fuelType: vehicle.fuelType || 'gasoline',
            currentKm: vehicle.currentKm?.toString() || '',
            googleCalendarId: vehicle.googleCalendarId || '',
            insuranceCompany: vehicle.insurance?.company || '',
            insurancePhone: vehicle.insurance?.phone || '',
        });
        setEditingVehicle(vehicle);
        setShowForm(true);
    };

    const handleModelNameChange = (val: string) => {
        setForm(prev => {
            const electric = isElectricModel(val);
            const hydrogen = isHydrogenModel(val);
            const guessed = guessVehicleType(val);

            let nextFuelType = prev.fuelType;
            
            // 친환경차(전기/수소)면 무조건 해당 연료로 고정
            if (electric) {
                nextFuelType = 'electric';
            } else if (hydrogen) {
                nextFuelType = 'hydrogen';
            } else if (guessed) {
                // 이전 연료가 전기/수소였는데 이제 아니게 된 경우 (예: '넥쏘' -> '소나타'로 수정)
                // 또는 원래부터 내연기관이었던 경우 -> 차종의 기본 연료 부여
                // (일반 차종의 기본 연료로 변경)
                if (prev.fuelType === 'electric' || prev.fuelType === 'hydrogen' || DEFAULT_FUEL[guessed]) {
                    nextFuelType = DEFAULT_FUEL[guessed] || prev.fuelType;
                }
            }

            return {
                ...prev,
                modelName: val,
                ...(guessed ? { vehicleType: guessed } : {}),
                fuelType: nextFuelType,
            };
        });
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!form.displayName.trim() || !form.plateNumber.trim()) return;
        const action = editingVehicle ? '차량 부분 수정' : '차량 등록';
        await runWithRetry(action, async () => {
            setFormLoading(true);
            try {
                const vehicleData = {
                    displayName: form.displayName.trim(),
                    modelName: form.modelName.trim(),
                    plateNumber: form.plateNumber.trim(),
                    vehicleType: form.vehicleType as Vehicle['vehicleType'],
                    fuelType: form.fuelType as FuelType,
                    currentKm: form.currentKm ? parseInt(form.currentKm) : 0,
                    organizationId: orgId!,
                    insurance: {
                        company: form.insuranceCompany.trim(),
                        phone: form.insurancePhone.trim(),
                    },
                    ...(form.googleCalendarId.trim() ? { googleCalendarId: form.googleCalendarId.trim() } : {}),
                };
                if (editingVehicle) {
                    await updateVehicle(editingVehicle.id, vehicleData);
                } else {
                    await createVehicle(vehicleData);
                }
                resetForm();
                await fetchVehicles();
            } finally {
                setFormLoading(false);
            }
        }, { errorMessage: `${action} 처리 중 오류가 발생했습니다.` });
    };

    // ── 모달을 통한 액션들 ──

    const closeModal = useCallback(() => setModal(null), []);

    // 차량 삭제 (confirm 모달)
    const openDeleteModal = (vehicle: Vehicle) => {
        setModal({ type: 'delete', vehicle });
    };
    const confirmDelete = async () => {
        const vehicle = modal?.vehicle;
        if (!vehicle) return;
        await runWithRetry('delete_vehicle', async () => {
            // 운행일지가 있으면 삭제 차단
            const hasLogs = await hasVehicleDriveLogs(vehicle.id);
            if (hasLogs) {
                showToast('운행일지가 존재하는 차량은 삭제할 수 없습니다. 폐차 처리를 이용하세요.', 'error');
                setModal(null);
                // 강제 예외 발생으로 기본 success toast 및 재시도 방지 (이미 유저 알림 띄웠으므로)
                const error = new Error('has_logs') as Error & { isHandled?: boolean };
                error.isHandled = true;
                throw error;
            }
            await deleteVehicle(vehicle.id);
            await fetchVehicles();
            setModal(null);
        }, {
            errorMessage: '차량 삭제 처리 중 오류가 발생했습니다.',
            onError: (err: unknown) => {
                if ((err as Error & { isHandled?: boolean }).isHandled) return true; // 이미 토스트 띄움
                return false; // 그 외 네트워크 에러 등은 공통 처리
            }
        });
    };

    // 정비 완료 (confirm 모달)
    const openClearMaintenanceModal = (vehicle: Vehicle) => {
        setModal({ type: 'clearMaintenance', vehicle });
    };
    const confirmClearMaintenance = async () => {
        const vehicle = modal?.vehicle;
        if (!vehicle) return;
        await runWithRetry('clear_maintenance', async () => {
            await clearVehicleMaintenanceBlock(vehicle.id);
            await fetchVehicles();
            setModal(null);
        }, { errorMessage: '정비/수리 차단 해제 중 오류가 발생했습니다.' });
    };

    // 폐차 처리 (input 모달)
    const openRetireModal = (vehicle: Vehicle) => {
        setModal({ type: 'retire', vehicle });
    };
    const confirmRetire = async (reason: string) => {
        const vehicle = modal?.vehicle;
        if (!vehicle) return;
        await runWithRetry('retire_vehicle', async () => {
            await retireVehicle(vehicle.id, reason);
            const today = new Date();
            const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
            await cancelVehicleReservations(orgId!, vehicle.id, vehicle.displayName || '', todayStr, null, `폐차 (${reason})`);
            await fetchVehicles();
            setModal(null);
        }, { errorMessage: '차량 폐차 처리 중 오류가 발생했습니다.' });
    };

    // 차량 복원 (confirm 모달)
    const openRestoreModal = (vehicle: Vehicle) => {
        setModal({ type: 'restore', vehicle });
    };
    const confirmRestore = async () => {
        const vehicle = modal?.vehicle;
        if (!vehicle) return;
        await runWithRetry('restore_vehicle', async () => {
            await restoreVehicle(vehicle.id);
            await fetchVehicles();
            setModal(null);
        }, { errorMessage: '차량 복원 처리 중 오류가 발생했습니다.' });
    };

    return {
        vehicles, loading, showForm, setShowForm,
        editingVehicle, formLoading, form, setForm,
        modal, closeModal, deletableIds,
        resetForm, handleEdit, handleModelNameChange, handleSubmit,
        openDeleteModal, confirmDelete,
        openClearMaintenanceModal, confirmClearMaintenance,
        openRetireModal, confirmRetire,
        openRestoreModal, confirmRestore,
    };
}
