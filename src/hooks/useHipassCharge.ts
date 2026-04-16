/**
 * useHipassCharge — 하이패스 충전 기록 상태 + CRUD 로직
 * 직원 화면의 "충전" 탭에서 사용하는 커스텀 훅
 */
import { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from './useAuth';
import { useToast } from './useToast';
import type { HipassCard } from '../types/hipass';
import type { HipassCharge } from '../types/hipassCharge';
import type { Vehicle } from '../types/vehicle';
import {
    updateHipassCard,
    createHipassCharge,
} from '../lib/firestore';
import { toLocalDateStr } from '../lib/dateUtils';
import useBaseHipassCharge from './base/useBaseHipassCharge';

const INITIAL_FORM = {
    date: toLocalDateStr(),
    chargeAmount: '',
};

export default function useHipassCharge() {
    const { user, userData } = useAuth();
    const { showToast } = useToast();

    const orgId = userData?.organizationId;
    const { 
        cards, setCards, 
        vehicles, 
        records, 
        loading, 
        loadRecordsForCard, 
        calculateTotalCharge, 
        handleDeleteBase 
    } = useBaseHipassCharge(orgId || undefined);

    const [selectedCardId, setSelectedCardId] = useState('');
    const [saving, setSaving] = useState(false);
    const [showForm, setShowForm] = useState(false);
    const [form, setForm] = useState(INITIAL_FORM);

    // 하이패스 카드가 1개일 경우 자동 선택
    useEffect(() => {
        if (cards.length === 1 && !selectedCardId) {
            setSelectedCardId(cards[0].id);
        }
    }, [cards, selectedCardId]);

    // 선택된 카드 변경 시 충전 기록 로드
    useEffect(() => {
        loadRecordsForCard(selectedCardId);
    }, [selectedCardId, loadRecordsForCard]);

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
        () => calculateTotalCharge(records),
        [records, calculateTotalCharge],
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
            await loadRecordsForCard(selectedCardId);

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
        await handleDeleteBase(rec, { checkingUid: user?.uid, rollbackBalance: true });
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
