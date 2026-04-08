/**
 * useHipassManager — 하이패스 관리 상태 + CRUD 로직
 * HipassManager에서 사용하는 커스텀 훅
 */
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from './useAuth';
import type { HipassCard } from '../types/hipass';
import type { Vehicle } from '../types/vehicle';
import { getHipassCards, createHipassCard, updateHipassCard, deleteHipassCard, getVehicles } from '../lib/firestore';
import { useToast } from './useToast';

interface HipassModal {
    type: 'delete';
    card: HipassCard;
}

const INITIAL_FORM = {
    cardNumber: '',
    vehicleId: '',
    balance: '',
    memo: '',
};

/** 숫자만 남기고 4자리마다 하이픈 삽입 */
const formatCardNumber = (raw: string): string => {
    const digits = raw.replace(/\D/g, '').slice(0, 16);
    return digits.replace(/(.{4})(?=.)/g, '$1-');
};

export default function useHipassManager() {
    const { userData } = useAuth();
    const { showToast } = useToast();
    const [cards, setCards] = useState<HipassCard[]>([]);
    const [vehicles, setVehicles] = useState<Vehicle[]>([]);
    const [loading, setLoading] = useState(true);
    const [showForm, setShowForm] = useState(false);
    const [editingCard, setEditingCard] = useState<HipassCard | null>(null);
    const [formLoading, setFormLoading] = useState(false);
    const [form, setForm] = useState(INITIAL_FORM);
    const [modal, setModal] = useState<HipassModal | null>(null);

    const orgId = userData?.organizationId;

    const fetchData = async () => {
        if (!orgId) { setLoading(false); return; }
        setLoading(true);
        try {
            // 각각 독립적으로 로드 (한쪽 실패가 다른 쪽에 영향 안 줌)
            const [cardsResult, vehiclesResult] = await Promise.allSettled([
                getHipassCards(orgId),
                getVehicles(orgId),
            ]);
            setCards(cardsResult.status === 'fulfilled' ? cardsResult.value : []);
            const vehiclesData = vehiclesResult.status === 'fulfilled' ? vehiclesResult.value : [];
            setVehicles(vehiclesData.filter((v: Vehicle) => !v.retired?.isRetired));
        } catch (err) {
            console.error('하이패스 목록 로드 실패:', err);
        } finally {
            setLoading(false);
        }
    };

    /* eslint-disable react-hooks/exhaustive-deps */
    useEffect(() => { fetchData(); }, [orgId]);
    /* eslint-enable react-hooks/exhaustive-deps */

    const resetForm = () => {
        setForm(INITIAL_FORM);
        setEditingCard(null);
        setShowForm(false);
    };

    const handleEdit = (card: HipassCard) => {
        setForm({
            cardNumber: card.cardNumber || '',
            vehicleId: card.vehicleId || '',
            balance: card.balance?.toString() || '0',
            memo: card.memo || '',
        });
        setEditingCard(card);
        setShowForm(true);
    };

    const handleCardNumberChange = (raw: string) => {
        setForm(prev => ({ ...prev, cardNumber: formatCardNumber(raw) }));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const digits = form.cardNumber.replace(/\D/g, '');
        if (!digits || !form.vehicleId) {
            showToast('카드번호와 차량을 입력해주세요.', 'error');
            return;
        }
        setFormLoading(true);
        try {
            const selectedVehicle = vehicles.find(v => v.id === form.vehicleId);

            // 다른 하이패스에 이미 연결된 차량인지 확인 (수정 시 자기 자신은 제외)
            const alreadyLinked = cards.find(
                c => c.vehicleId === form.vehicleId && c.id !== editingCard?.id
            );
            if (alreadyLinked) {
                showToast('이 차량에는 이미 하이패스가 연결되어 있습니다.', 'error');
                setFormLoading(false);
                return;
            }

            const cardData = {
                cardNumber: form.cardNumber.trim(),
                vehicleId: form.vehicleId,
                vehicleName: selectedVehicle?.displayName || '',
                balance: form.balance ? parseInt(form.balance) : 0,
                memo: form.memo.trim(),
                organizationId: orgId,
            };

            if (editingCard) {
                await updateHipassCard(editingCard.id, cardData);
                showToast('하이패스 정보가 수정되었습니다.', 'success');
            } else {
                await createHipassCard(cardData);
                showToast('하이패스가 등록되었습니다.', 'success');
            }
            resetForm();
            await fetchData();
        } catch (err) {
            console.error('저장 실패:', err);
            showToast('저장에 실패했습니다.', 'error');
        } finally {
            setFormLoading(false);
        }
    };

    // ── 모달 액션 ──
    const closeModal = useCallback(() => setModal(null), []);

    const openDeleteModal = (card: HipassCard) => {
        setModal({ type: 'delete', card });
    };

    const confirmDelete = async () => {
        const card = modal?.card;
        if (!card) return;
        try {
            await deleteHipassCard(card.id);
            showToast('하이패스가 삭제되었습니다.', 'success');
            await fetchData();
        } catch (err) {
            console.error('삭제 실패:', err);
            showToast('삭제에 실패했습니다.', 'error');
        } finally {
            setModal(null);
        }
    };

    // 차량 중 아직 하이패스가 연결되지 않은 차량 + 현재 편집 중인 카드에 연결된 차량
    const availableVehicles = vehicles.filter(v => {
        const linked = cards.find(c => c.vehicleId === v.id);
        return !linked || linked.id === editingCard?.id;
    });

    /** vehicleId로 차량 객체 찾기 */
    const getVehicleById = useCallback(
        (vehicleId: string) => vehicles.find(v => v.id === vehicleId),
        [vehicles],
    );

    return {
        cards, vehicles, availableVehicles, loading,
        showForm, setShowForm,
        editingCard, formLoading, form, setForm,
        modal, closeModal,
        resetForm, handleEdit, handleCardNumberChange, handleSubmit,
        openDeleteModal, confirmDelete,
        getVehicleById,
    };
}
