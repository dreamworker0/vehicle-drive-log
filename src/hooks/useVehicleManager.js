/**
 * useVehicleManager — 차량 관리 상태 + CRUD 로직
 * VehicleManager에서 추출된 커스텀 훅
 */
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from './useAuth';
import { getVehicles, createVehicle, updateVehicle, deleteVehicle, clearVehicleMaintenanceBlock, retireVehicle, restoreVehicle, cancelVehicleReservations } from '../lib/firestore';

// 전기차 모델명 목록 (감지 시 fuelType을 electric으로 자동 설정)
const ELECTRIC_MODELS = [
    '아이오닉', '아이오닉5', '아이오닉6', '아이오닉7',
    'EV6', 'EV9', 'EV3', '니로EV', '니로 EV', '코나EV', '코나 EV', '코나 일렉트릭',
    '볼트EV', '볼트 EV', '볼트EUV',
    '테슬라', 'Model 3', 'Model Y', 'Model S', 'Model X',
    'e-트론', 'ID.4', '폴스타', '제로', 'i4', 'iX',
    'SM3 Z.E', 'ZOE', '트위지',
    '포터EV', '포터 EV', '봉고EV', '봉고 EV',
];

// 모델명 → 차종 자동 매핑
const MODEL_TYPE_MAP = {
    compact: ['모닝', '캐스퍼', '마티즈', '레이', '스파크', '다마스', '티코', '트위즈', '피카퇠'],
    sedan: ['소나타', '아반떼', '그랜저', 'K5', 'K3', 'K7', 'K8', 'K9', '말리부', '셀토스', '제네시스', 'SM6', 'SM3', '투슨', 'i30', 'i40'],
    van: ['스타렉스', '스타리아', '카니발', '콴라티', '보나식', '포터', '투산', '마스터', '보고', '싶온', '라바'],
    bus: ['유니버스', '에어로', '카운티', '레스타', '솔라티', '시티', '마이티', '그린시티'],
};

// 모델명이 전기차인지 판별
const isElectricModel = (modelName) => {
    const name = modelName.trim().toLowerCase();
    if (!name) return false;
    return ELECTRIC_MODELS.some(m => name.includes(m.toLowerCase()));
};

const guessVehicleType = (modelName) => {
    const name = modelName.trim().toLowerCase();
    if (!name) return null;
    for (const [type, models] of Object.entries(MODEL_TYPE_MAP)) {
        if (models.some(m => name.includes(m.toLowerCase()))) return type;
    }
    return null;
};

// 차종별 기본 연료 유형
export const DEFAULT_FUEL = { compact: 'gasoline', sedan: 'gasoline', van: 'diesel', bus: 'diesel' };

const INITIAL_FORM = {
    displayName: '', modelName: '', plateNumber: '',
    vehicleType: 'sedan', fuelType: 'gasoline',
    currentKm: '', googleCalendarId: '',
    insuranceCompany: '', insurancePhone: '',
};

export default function useVehicleManager() {
    const { userData } = useAuth();
    const [vehicles, setVehicles] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showForm, setShowForm] = useState(false);
    const [editingVehicle, setEditingVehicle] = useState(null);
    const [formLoading, setFormLoading] = useState(false);
    const [form, setForm] = useState(INITIAL_FORM);

    // 모달 상태 — { type, vehicle, action } 형태로 관리
    const [modal, setModal] = useState(null);

    const orgId = userData?.organizationId;

    const fetchVehicles = async () => {
        if (!orgId) return;
        setLoading(true);
        try {
            const data = await getVehicles(orgId);
            setVehicles(data);
        } catch (err) {
            console.error('차량 목록 로드 실패:', err);
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

    const handleEdit = (vehicle) => {
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

    const handleModelNameChange = (val) => {
        const electric = isElectricModel(val);
        const guessed = guessVehicleType(val);
        setForm(prev => ({
            ...prev,
            modelName: val,
            // 전기차 모델이면 fuelType을 electric으로 강제 설정
            ...(electric ? { fuelType: 'electric' } : {}),
            ...(guessed ? { vehicleType: guessed, ...(!electric ? { fuelType: DEFAULT_FUEL[guessed] || prev.fuelType } : {}) } : {}),
        }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!form.displayName.trim() || !form.plateNumber.trim()) return;
        setFormLoading(true);
        try {
            const vehicleData = {
                displayName: form.displayName.trim(),
                modelName: form.modelName.trim(),
                plateNumber: form.plateNumber.trim(),
                vehicleType: form.vehicleType,
                fuelType: form.fuelType,
                currentKm: form.currentKm ? parseInt(form.currentKm) : 0,
                organizationId: orgId,
                insurance: {
                    company: form.insuranceCompany.trim(),
                    phone: form.insurancePhone.trim(),
                },
            };
            if (form.googleCalendarId.trim()) {
                vehicleData.googleCalendarId = form.googleCalendarId.trim();
            }
            if (editingVehicle) {
                await updateVehicle(editingVehicle.id, vehicleData);
            } else {
                await createVehicle(vehicleData);
            }
            resetForm();
            await fetchVehicles();
        } catch (err) {
            console.error('저장 실패:', err);
        } finally {
            setFormLoading(false);
        }
    };

    // ── 모달을 통한 액션들 ──

    const closeModal = useCallback(() => setModal(null), []);

    // 차량 삭제 (confirm 모달)
    const openDeleteModal = (vehicle) => {
        setModal({ type: 'delete', vehicle });
    };
    const confirmDelete = async () => {
        const vehicle = modal?.vehicle;
        if (!vehicle) return;
        try {
            await deleteVehicle(vehicle.id);
            await fetchVehicles();
        } catch (err) {
            console.error('삭제 실패:', err);
        } finally {
            setModal(null);
        }
    };

    // 정비 완료 (confirm 모달)
    const openClearMaintenanceModal = (vehicle) => {
        setModal({ type: 'clearMaintenance', vehicle });
    };
    const confirmClearMaintenance = async () => {
        const vehicle = modal?.vehicle;
        if (!vehicle) return;
        try {
            await clearVehicleMaintenanceBlock(vehicle.id);
            await fetchVehicles();
        } catch (err) {
            console.error('차단 해제 실패:', err);
        } finally {
            setModal(null);
        }
    };

    // 폐차 처리 (input 모달)
    const openRetireModal = (vehicle) => {
        setModal({ type: 'retire', vehicle });
    };
    const confirmRetire = async (reason) => {
        const vehicle = modal?.vehicle;
        if (!vehicle) return;
        try {
            await retireVehicle(vehicle.id, reason);
            const today = new Date();
            const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
            await cancelVehicleReservations(orgId, vehicle.id, vehicle.displayName, todayStr, null, `폐차 (${reason})`);
            await fetchVehicles();
        } catch (err) {
            console.error('폐차 처리 실패:', err);
        } finally {
            setModal(null);
        }
    };

    // 차량 복원 (confirm 모달)
    const openRestoreModal = (vehicle) => {
        setModal({ type: 'restore', vehicle });
    };
    const confirmRestore = async () => {
        const vehicle = modal?.vehicle;
        if (!vehicle) return;
        try {
            await restoreVehicle(vehicle.id);
            await fetchVehicles();
        } catch (err) {
            console.error('복원 실패:', err);
        } finally {
            setModal(null);
        }
    };

    return {
        vehicles, loading, showForm, setShowForm,
        editingVehicle, formLoading, form, setForm,
        modal, closeModal,
        resetForm, handleEdit, handleModelNameChange, handleSubmit,
        openDeleteModal, confirmDelete,
        openClearMaintenanceModal, confirmClearMaintenance,
        openRetireModal, confirmRetire,
        openRestoreModal, confirmRestore,
    };
}
