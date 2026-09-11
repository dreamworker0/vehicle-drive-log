/**
 * useFuelLogAdmin — 관리자용 주유 기록 관리 훅
 * FuelLogManager에서 사용하는 커스텀 훅
 *
 * 로드·삭제·합산은 useBaseFuelLog가 담당하고, 이 훅은 관리자 화면의 필터링과
 * 기록 정정(수정)만 얹는다.
 * (useHipassChargeAdmin ↔ useBaseHipassCharge와 같은 구조다. base 훅의 주석은 처음부터
 *  "일반 직원 훅과 관리자 훅에서 공통으로 사용"이라고 밝히고 있었지만 실제로는 직원 훅만
 *  쓰고 있어, 관리자 쪽이 같은 로드·삭제 로직을 따로 구현해 두 벌로 갈라져 있었다.)
 *
 * ## 왜 관리자가 남의 기록을 고치나
 * 지출결의서와 주유일지를 대조하다 주유량·금액 오류를 찾아도, 예전에는 **주유 당사자만**
 * 고칠 수 있었다. 관리자에게는 (되돌릴 수 없는) 삭제만 열려 있어 "지우고 직원에게 다시
 * 입력 요청"이라는 더 나쁜 우회를 쓰게 됐다. Rules는 처음부터 기관 관리자의 수정을
 * 허용하고 있었으므로(isOrgAdmin 분기) 막고 있던 것은 화면뿐이었다.
 *
 * ## 무엇은 고치지 않나
 * **주유원(driverUid·driverName)은 바꾸지 않는다.** 누가 넣은 기록인가는 기록의 정체성이라
 * 그게 틀렸다면 정정이 아니라 삭제 후 재등록이 맞다. 대신 관리자가 고치면 actorStamp가
 * 마지막 수정자를 남겨(updateFuelLog) 목록에 '관리자 수정' 표시가 뜬다.
 */
import { useState, useMemo } from 'react';
import { useAuth } from './useAuth';
import { useToast } from './useToast';
import type { FuelLog } from '../types/fuelLog';
import useBaseFuelLog from './base/useBaseFuelLog';
import { updateFuelLog } from '../lib/firestore';
import { validateNonNegativeFields } from './utils/numberValidation';
import { roundFuelAmount } from '../lib/fuelFormat';

/** 수정 폼 값 — 입력 중에는 전부 문자열로 다룬다(저장 직전에 숫자로 바꾼다). */
export interface FuelLogEditForm {
    vehicleId: string;
    vehicleName: string;
    date: string;
    meterReading: string;
    fuelAmount: string;
    fuelCost: string;
    notes: string;
}

const EMPTY_FORM: FuelLogEditForm = {
    vehicleId: '', vehicleName: '', date: '',
    meterReading: '', fuelAmount: '', fuelCost: '', notes: '',
};

export default function useFuelLogAdmin() {
    const { user, userData } = useAuth();
    const orgId = userData?.organizationId;
    const { showToast } = useToast();

    // organizationId는 기관 미소속 시 null이므로 undefined로 좁혀 넘긴다(base 훅이 스킵 처리).
    const { vehicles, records, setRecords, loading, calculateStats, handleDeleteBase } = useBaseFuelLog(orgId ?? undefined);

    const [filters, setFilters] = useState({
        search: '',
        vehicleId: '',
        startDate: '',
        endDate: '',
    });

    // 수정 상태 — 편집 중인 기록과 폼
    const [editingRecord, setEditingRecord] = useState<FuelLog | null>(null);
    const [form, setForm] = useState<FuelLogEditForm>(EMPTY_FORM);
    const [saving, setSaving] = useState(false);

    const filteredRecords = useMemo(() => {
        return records
            .filter(r => {
                if (filters.vehicleId && r.vehicleId !== filters.vehicleId) return false;
                if (filters.startDate && r.date < filters.startDate) return false;
                if (filters.endDate && r.date > filters.endDate) return false;
                if (filters.search) {
                    const s = filters.search.toLowerCase();
                    return (
                        r.vehicleName?.toLowerCase().includes(s) ||
                        r.driverName?.toLowerCase().includes(s)
                    );
                }
                return true;
            })
            .map(r => {
                const v = vehicles.find(v => v.id === r.vehicleId);
                return {
                    ...r,
                    vehicleType: v?.vehicleType || null,
                    fuelType: (r.fuelType || v?.fuelType || 'gasoline') as 'gasoline' | 'electric',
                };
            });
    }, [records, filters, vehicles]);

    // 합계는 필터링된 목록 기준이다 — 화면에 보이는 것과 숫자가 어긋나면 안 된다.
    const { cost: totalCost, amount: totalAmount } = useMemo(
        () => calculateStats(filteredRecords),
        [filteredRecords, calculateStats],
    );

    const resetFilters = () => setFilters({ search: '', vehicleId: '', startDate: '', endDate: '' });

    // 관리자는 기관 전체 기록을 삭제할 수 있으므로 본인 확인(checkingUid)을 넘기지 않는다.
    const handleDelete = (rec: FuelLog) => handleDeleteBase(rec);

    // ── 기록 정정 ──

    const handleEdit = (rec: FuelLog) => {
        setEditingRecord(rec);
        setForm({
            vehicleId: rec.vehicleId,
            vehicleName: rec.vehicleName || '',
            date: rec.date,
            // `|| ''`가 아니라 null 검사다 — 0으로 저장된 옛 기록이 빈 칸으로 채워지면
            // 필수값 검사에 걸려 그 기록은 아예 고칠 수 없게 된다.
            meterReading: rec.meterReading != null ? String(rec.meterReading) : '',
            fuelAmount: rec.fuelAmount != null ? String(rec.fuelAmount) : '',
            fuelCost: rec.fuelCost != null ? String(rec.fuelCost) : '',
            notes: rec.notes || '',
        });
    };

    const handleCancelEdit = () => {
        setEditingRecord(null);
        setForm(EMPTY_FORM);
    };

    const handleVehicleSelect = (vehicleId: string) => {
        const v = vehicles.find(v => v.id === vehicleId);
        setForm(prev => ({
            ...prev,
            vehicleId,
            // 차량 목록에 없는(삭제된) 차량을 그대로 다시 고른 경우엔 기록에 남아 있던
            // 이름을 지우지 않는다 — 지우면 목록·내보내기에서 차량이 빈칸이 된다.
            vehicleName: v?.displayName || (vehicleId === prev.vehicleId ? prev.vehicleName : ''),
        }));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!editingRecord) return;

        if (!form.vehicleId || !form.date || !form.meterReading || !form.fuelAmount || !form.fuelCost) {
            showToast('모든 필수 항목을 입력해주세요.', 'warning');
            return;
        }

        const negativeError = validateNonNegativeFields([
            { label: '주유미터', value: form.meterReading },
            { label: '주유량', value: form.fuelAmount },
            { label: '주유금액', value: form.fuelCost },
        ]);
        if (negativeError) {
            showToast(negativeError, 'warning');
            return;
        }

        // 직원 폼과 달리 '차량 현재 누적 km보다 작다'는 경고는 걸지 않는다 — 관리자가 고치는
        // 것은 대개 지난 기록이라 현재 km보다 작은 게 정상이고, 매번 뜨면 경고가 소음이 된다.

        setSaving(true);
        try {
            const selectedVehicle = vehicles.find(v => v.id === form.vehicleId);
            const payload = {
                vehicleId: form.vehicleId,
                vehicleName: form.vehicleName,
                date: form.date,
                // parseInt가 아니라 Number로 읽는다 — `<input type="number">`는 지수 표기
                // ('1e5')도 유효한 값으로 넘기고, parseInt는 그것을 1로 읽는다(50,000km가
                // 1km로 조용히 저장된다). limitFuelDecimals가 같은 함정을 주석으로 남겨 뒀다.
                meterReading: Math.trunc(Number(form.meterReading)),
                fuelType: selectedVehicle?.fuelType || editingRecord.fuelType || 'gasoline',
                // 저장 길목에서 자릿수를 맞춘다 — 입력 칸만 제한하면 기존 값을 그대로 되쓸 때 통과한다.
                fuelAmount: roundFuelAmount(form.fuelAmount),
                fuelCost: Math.trunc(Number(form.fuelCost)),
                notes: form.notes.trim() || '',
            };

            await updateFuelLog(editingRecord.id, payload);

            // 목록을 다시 불러오지 않고 그 자리만 갱신한다(읽기 비용 절약).
            // lastEditedByUid는 updateFuelLog가 심는 값과 같은 것을 화면에도 반영한다 —
            // 저장 직후부터 '관리자 수정' 표시가 보여야 한다.
            setRecords(prev => prev.map(r => (
                r.id === editingRecord.id ? { ...r, ...payload, lastEditedByUid: user?.uid } : r
            )));
            showToast('주유 기록이 수정되었습니다.', 'success');
            handleCancelEdit();
        } catch (err) {
            console.error('주유 기록 수정 실패:', err);
            showToast('수정에 실패했습니다.', 'error');
        } finally {
            setSaving(false);
        }
    };

    return {
        vehicles, loading,
        filters, setFilters, resetFilters,
        filteredRecords, totalCost, totalAmount,
        handleDelete,
        // 정정
        editingRecord, form, setForm, saving,
        handleEdit, handleCancelEdit, handleVehicleSelect, handleSubmit,
    };
}
