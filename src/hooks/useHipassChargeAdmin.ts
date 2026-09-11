/**
 * useHipassChargeAdmin — 관리자용 하이패스 충전 기록 관리 훅
 * useFuelLogAdmin 패턴 기반
 *
 * ## 관리자 정정(수정)
 * 주유 기록과 같은 이유로 관리자가 직원의 충전 기록을 고칠 수 있다
 * (배경은 useFuelLogAdmin 주석 참고). 다른 점은 **카드 잔액**이다 — 충전 기록은
 * 생성 시 카드 잔액을 그만큼 올리므로(useHipassCharge), 금액을 고치면 잔액도 같이
 * 맞춰야 앱이 들고 있는 잔액이 거짓이 되지 않는다. 차액은 저장 시 확인창에 그대로
 * 보여 주고, 카드가 이미 삭제됐으면 기록만 고친다.
 *
 * 충전자(chargerUid·chargerName)와 카드는 바꾸지 않는다 — 기록의 정체성이라
 * 틀렸다면 삭제 후 재등록이 맞다.
 */
import { useState, useMemo } from 'react';
import { useAuth } from './useAuth';
import { useToast } from './useToast';
import { useConfirm } from './useConfirm';
import type { HipassCharge } from '../types/hipassCharge';
import useBaseHipassCharge from './base/useBaseHipassCharge';
import { updateHipassCharge, updateHipassCard } from '../lib/firestore';
import { validateNonNegativeFields, parseIntegerInput } from './utils/numberValidation';

/** 수정 폼 값 — 입력 중에는 문자열로 다룬다(저장 직전에 숫자로 바꾼다). */
export interface HipassChargeEditForm {
    date: string;
    chargeAmount: string;
}

const EMPTY_FORM: HipassChargeEditForm = { date: '', chargeAmount: '' };

export default function useHipassChargeAdmin() {
    const { user, userData } = useAuth();
    const orgId = userData?.organizationId;
    const { showToast } = useToast();
    const { confirm } = useConfirm();

    const {
        vehicles,
        cards, setCards,
        records, setRecords,
        loading,
        calculateTotalCharge,
        handleDeleteBase
    } = useBaseHipassCharge(orgId ? orgId : undefined, { isAdmin: true });

    const [filters, setFilters] = useState({
        search: '',
        vehicleId: '',
        startDate: '',
        endDate: '',
    });

    // 수정 상태 — 편집 중인 기록과 폼
    const [editingRecord, setEditingRecord] = useState<HipassCharge | null>(null);
    const [form, setForm] = useState<HipassChargeEditForm>(EMPTY_FORM);
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
                        r.chargerName?.toLowerCase().includes(s) ||
                        r.cardNumber?.toLowerCase().includes(s)
                    );
                }
                return true;
            });
    }, [records, filters]);

    const totalChargeAmount = useMemo(() => calculateTotalCharge(filteredRecords), [filteredRecords, calculateTotalCharge]);

    // ── 통계 데이터 ──

    /** 월별 충전 추세 (최근 6개월) */
    const monthlyTrend = useMemo(() => {
        const byMonth: Record<string, { amount: number; count: number }> = {};
        records.forEach(r => {
            const month = r.date?.slice(0, 7); // 'YYYY-MM'
            if (!month) return;
            if (!byMonth[month]) byMonth[month] = { amount: 0, count: 0 };
            byMonth[month].amount += r.chargeAmount || 0;
            byMonth[month].count++;
        });
        return Object.entries(byMonth)
            .sort((a, b) => a[0].localeCompare(b[0]))
            .slice(-6)
            .map(([month, data]) => ({ month: month.slice(2), ...data })); // 'YY-MM'
    }, [records]);

    /** 카드별 사용량 집계 */
    const cardStats = useMemo(() => {
        const byCard: Record<string, { amount: number; count: number }> = {};
        records.forEach(r => {
            const card = r.cardNumber || '(미지정)';
            if (!byCard[card]) byCard[card] = { amount: 0, count: 0 };
            byCard[card].amount += r.chargeAmount || 0;
            byCard[card].count++;
        });
        return Object.entries(byCard)
            .sort((a, b) => b[1].amount - a[1].amount)
            .map(([name, data]) => ({ name, ...data }));
    }, [records]);

    /** 차량별 충전 집계 */
    const vehicleStats = useMemo(() => {
        const byVehicle: Record<string, { amount: number; count: number }> = {};
        records.forEach(r => {
            const name = r.vehicleName || '(미지정)';
            if (!byVehicle[name]) byVehicle[name] = { amount: 0, count: 0 };
            byVehicle[name].amount += r.chargeAmount || 0;
            byVehicle[name].count++;
        });
        return Object.entries(byVehicle)
            .sort((a, b) => b[1].amount - a[1].amount)
            .map(([name, data]) => ({ name, ...data }));
    }, [records]);

    const resetFilters = () => setFilters({ search: '', vehicleId: '', startDate: '', endDate: '' });

    const handleDelete = async (rec: HipassCharge) => {
        // 관리자 삭제도 카드 잔액을 되돌린다. 정정(수정)은 차액만큼 잔액을 맞추면서 삭제는
        // 그대로 두면, **같은 화면에서 어느 버튼을 누르느냐에 따라 잔액이 맞기도 하고
        // 틀리기도 한다.** 직원 삭제는 원래 되돌리고 있었으므로 그쪽과도 어긋나 있었다.
        // 본인 확인(checkingUid)은 넘기지 않는다 — 관리자는 기관 전체 기록을 지운다.
        await handleDeleteBase(rec, { rollbackBalance: true });
    };

    // ── 기록 정정 ──

    const handleEdit = (rec: HipassCharge) => {
        setEditingRecord(rec);
        // `|| ''`가 아니라 null 검사다 — 0으로 저장된 옛 기록이 빈 칸으로 채워지면
        // 필수값 검사에 걸려 그 기록은 아예 고칠 수 없게 된다.
        setForm({ date: rec.date, chargeAmount: rec.chargeAmount != null ? String(rec.chargeAmount) : '' });
    };

    const handleCancelEdit = () => {
        setEditingRecord(null);
        setForm(EMPTY_FORM);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!editingRecord) return;

        if (!form.date || !form.chargeAmount) {
            showToast('날짜와 충전금액을 입력해주세요.', 'warning');
            return;
        }

        const negativeError = validateNonNegativeFields([{ label: '충전금액', value: form.chargeAmount }]);
        if (negativeError) {
            showToast(negativeError, 'warning');
            return;
        }

        const amount = parseIntegerInput(form.chargeAmount);
        if (isNaN(amount) || amount <= 0) {
            showToast('올바른 충전금액을 입력해주세요.', 'warning');
            return;
        }

        const delta = amount - (editingRecord.chargeAmount || 0);
        const card = cards.find(c => c.id === editingRecord.cardId);

        // 금액이 바뀌면 카드 잔액도 그만큼 어긋난다 — 얼마가 어떻게 바뀌는지 미리 보여 준다.
        if (delta !== 0) {
            const sign = delta > 0 ? '+' : '−';
            const message = card
                ? `충전금액을 ${(editingRecord.chargeAmount || 0).toLocaleString()}원 → ${amount.toLocaleString()}원으로 수정합니다.\n`
                  + `카드(${editingRecord.cardNumber}) 잔액도 함께 조정됩니다: `
                  + `${card.balance.toLocaleString()}원 → ${Math.max(0, card.balance + delta).toLocaleString()}원 (${sign}${Math.abs(delta).toLocaleString()}원)`
                : `충전금액을 ${(editingRecord.chargeAmount || 0).toLocaleString()}원 → ${amount.toLocaleString()}원으로 수정합니다.\n`
                  + '연결된 카드를 찾을 수 없어 카드 잔액은 조정되지 않습니다.';
            if (!await confirm({ message, confirmText: '수정' })) return;
        }

        setSaving(true);
        try {
            // balanceAfter는 '충전 전 잔액 + 충전금액'이라는 그 시점의 계산 결과다 —
            // 금액을 고치면 이 값도 같이 맞춰야 기록 안에서 앞뒤가 맞는다.
            const payload = {
                date: form.date,
                chargeAmount: amount,
                // 충전 후 잔액은 **금액이 바뀔 때만** 다시 계산한다. 날짜만 고치는데도
                // 덮어쓰면, balanceBefore가 비어 있는 옛 기록에서 멀쩡하던 '충전후잔액'이
                // 지워진다. 기준을 balanceBefore가 아니라 balanceAfter에 두는 이유도 같다 —
                // 기록이 앞뒤로 어긋나 있어도 차액만큼만 움직인다.
                ...(delta !== 0 ? { balanceAfter: (editingRecord.balanceAfter || 0) + delta } : {}),
            };

            await updateHipassCharge(editingRecord.id, payload);

            // 잔액 조정은 별도로 잡는다 — 기록 쓰기는 이미 성공했으므로 여기서 통째로
            // "수정 실패"라고 알리면 거짓말이 된다. 어긋난 것이 잔액뿐임을 그대로 말한다.
            let balanceAdjusted = true;
            if (delta !== 0 && card) {
                const newBalance = Math.max(0, card.balance + delta);
                try {
                    await updateHipassCard(card.id, { balance: newBalance });
                    setCards(prev => prev.map(c => (c.id === card.id ? { ...c, balance: newBalance } : c)));
                } catch (err) {
                    balanceAdjusted = false;
                    console.error('카드 잔액 조정 실패:', err);
                }
            }

            // 목록을 다시 읽지 않고 그 자리만 갱신한다(읽기 비용 절약).
            setRecords(prev => prev.map(r => (
                r.id === editingRecord.id ? { ...r, ...payload, lastEditedByUid: user?.uid } : r
            )));
            if (balanceAdjusted) {
                showToast('충전 기록이 수정되었습니다.', 'success');
            } else {
                showToast('기록은 수정됐지만 카드 잔액 조정에 실패했습니다. [하이패스 관리]에서 잔액을 확인해주세요.', 'warning');
            }
            handleCancelEdit();
        } catch (err) {
            console.error('충전 기록 수정 실패:', err);
            showToast('수정에 실패했습니다.', 'error');
        } finally {
            setSaving(false);
        }
    };

    return {
        vehicles, loading,
        filters, setFilters, resetFilters,
        filteredRecords, totalChargeAmount,
        monthlyTrend, cardStats, vehicleStats,
        handleDelete,
        // 정정
        editingRecord, form, setForm, saving,
        handleEdit, handleCancelEdit, handleSubmit,
    };
}
