/**
 * useHipassCharge — 하이패스 충전 기록 상태 + CRUD 로직
 * 직원 화면의 "충전" 탭에서 사용하는 커스텀 훅
 */
import { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from './useAuth';
import { useToast } from './useToast';
import { useConfirm } from '../contexts/ConfirmContext';
import type { HipassCard } from '../types/hipass';
import type { HipassCharge } from '../types/hipassCharge';
import type { Vehicle } from '../types/vehicle';
import {
    getVehicles,
    getHipassCards, updateHipassCard,
    getHipassCharges, createHipassCharge, deleteHipassCharge,
} from '../lib/firestore';
import { toLocalDateStr } from '../lib/dateUtils';

const INITIAL_FORM = {
    date: toLocalDateStr(),
    chargeAmount: '',
};

export default function useHipassCharge() {
    const { user, userData } = useAuth();
    const { showToast } = useToast();
    const { confirm } = useConfirm();

    const [cards, setCards] = useState<HipassCard[]>([]);
    const [vehicles, setVehicles] = useState<Vehicle[]>([]);
    const [selectedCardId, setSelectedCardId] = useState('');
    const [records, setRecords] = useState<HipassCharge[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [showForm, setShowForm] = useState(false);
    const [form, setForm] = useState(INITIAL_FORM);

    const orgId = userData?.organizationId;

    // 하이패스 카드 목록 로드
    useEffect(() => {
        if (!orgId) { setLoading(false); return; }
        const fetchAll = async () => {
            try {
                const [c, v] = await Promise.all([
                    getHipassCards(orgId),
                    getVehicles(orgId),
                ]);
                setCards(c as HipassCard[]);
                setVehicles(v as Vehicle[]);
                // 카드가 1개면 자동 선택
                if (c.length === 1) setSelectedCardId(c[0].id);
            } catch (err) {
                console.error('하이패스 카드/차량 로드 실패:', err);
            }
            setLoading(false);
        };
        fetchAll();
    }, [orgId]);

    // 선택된 카드 변경 시 충전 기록 로드
    useEffect(() => {
        if (!orgId || !selectedCardId) {
            setRecords([]);
            return;
        }
        const fetchCharges = async () => {
            try {
                const r = await getHipassCharges(orgId, selectedCardId);
                setRecords(r as HipassCharge[]);
            } catch (err) {
                console.warn('충전 기록 로드 실패:', err);
                setRecords([]);
            }
        };
        fetchCharges();
    }, [orgId, selectedCardId]);

    // 선택된 카드 정보
    const selectedCard = useMemo(
        () => cards.find(c => c.id === selectedCardId) || null,
        [cards, selectedCardId],
    );

    // 충전 후 예상 잔액
    const balanceAfter = useMemo(() => {
        if (!selectedCard || !form.chargeAmount) return null;
        const amount = parseInt(form.chargeAmount);
        if (isNaN(amount) || amount <= 0) return null;
        return selectedCard.balance + amount;
    }, [selectedCard, form.chargeAmount]);

    // 충전 기록 합계
    const totalChargeAmount = useMemo(
        () => records.reduce((sum, r) => sum + (r.chargeAmount || 0), 0),
        [records],
    );

    // vehicleId로 차량 조회 헬퍼
    const getVehicleById = useCallback(
        (vehicleId: string) => vehicles.find(v => v.id === vehicleId) || null,
        [vehicles],
    );

    // 카드 선택 핸들러
    const handleCardSelect = useCallback((cardId: string) => {
        setSelectedCardId(cardId);
        setForm(INITIAL_FORM);
        setShowForm(false);
    }, []);

    // 저장
    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedCard || !form.date || !form.chargeAmount) {
            showToast('모든 필수 항목을 입력해주세요.', 'warning');
            return;
        }
        const amount = parseInt(form.chargeAmount);
        if (isNaN(amount) || amount <= 0) {
            showToast('올바른 충전금액을 입력해주세요.', 'warning');
            return;
        }

        setSaving(true);
        try {
            const before = selectedCard.balance;
            const after = before + amount;

            // 1. 충전 기록 생성
            await createHipassCharge({
                organizationId: orgId,
                cardId: selectedCard.id,
                cardNumber: selectedCard.cardNumber,
                vehicleId: selectedCard.vehicleId,
                vehicleName: selectedCard.vehicleName || '',
                chargerUid: user?.uid,
                chargerName: userData?.name || user?.displayName || '',
                date: form.date,
                chargeAmount: amount,
                balanceBefore: before,
                balanceAfter: after,
            });

            // 2. 카드 잔액 업데이트
            await updateHipassCard(selectedCard.id, { balance: after });

            // 3. 로컬 상태 갱신
            setCards(prev => prev.map(c =>
                c.id === selectedCard.id ? { ...c, balance: after } : c
            ));
            const updated = await getHipassCharges(orgId!, selectedCardId);
            setRecords(updated as HipassCharge[]);

            setForm(INITIAL_FORM);
            setShowForm(false);
            showToast('충전 기록이 저장되었습니다.', 'success');
        } catch (err) {
            console.error('충전 기록 저장 실패:', err);
            showToast('저장에 실패했습니다.', 'error');
        } finally {
            setSaving(false);
        }
    };

    // 삭제
    const handleDelete = async (rec: HipassCharge) => {
        if (rec.chargerUid !== user?.uid) {
            showToast('본인의 충전 기록만 삭제할 수 있습니다.', 'warning');
            return;
        }
        if (!await confirm({ message: '이 충전 기록을 삭제하시겠습니까?\n카드 잔액이 원래대로 되돌아갑니다.', confirmColor: 'danger' })) return;

        try {
            // 1. 충전 기록 삭제
            await deleteHipassCharge(rec.id);

            // 2. 카드 잔액 원복 (충전금액만큼 차감)
            const card = cards.find(c => c.id === rec.cardId);
            if (card) {
                const newBalance = Math.max(0, card.balance - rec.chargeAmount);
                await updateHipassCard(card.id, { balance: newBalance });
                setCards(prev => prev.map(c =>
                    c.id === card.id ? { ...c, balance: newBalance } : c
                ));
            }

            setRecords(prev => prev.filter(r => r.id !== rec.id));
            showToast('충전 기록이 삭제되었습니다.', 'success');
        } catch (err) {
            console.error('삭제 실패:', err);
            showToast('삭제에 실패했습니다.', 'error');
        }
    };

    return {
        cards, vehicles, selectedCardId, selectedCard,
        records, loading, saving,
        showForm, setShowForm,
        form, setForm,
        balanceAfter, totalChargeAmount,
        handleCardSelect, handleSubmit, handleDelete,
        getVehicleById,
        currentUid: user?.uid,
    };
}
