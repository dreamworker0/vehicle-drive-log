import { useState, useEffect, useCallback } from 'react';
import type { Vehicle } from '../../types/vehicle';
import type { HipassCharge } from '../../types/hipassCharge';
import type { HipassCard } from '../../types/hipass';
import { 
    getVehicles, 
    getHipassCards, 
    getAllHipassCharges, 
    getHipassCharges, 
    deleteHipassCharge, 
    updateHipassCard 
} from '../../lib/firestore';
import { useConfirm } from '../useConfirm';
import { useToast } from '../useToast';

/**
 * useBaseHipassCharge
 * 하이패스 데이터 로드, 합산 로직, 삭제 로직(카드 잔액 롤백 포함)을 공통화하는 Base Hook
 */
export default function useBaseHipassCharge(orgId: string | undefined, options?: { isAdmin?: boolean }) {
    const isAdmin = options?.isAdmin || false;
    const [vehicles, setVehicles] = useState<Vehicle[]>([]);
    const [cards, setCards] = useState<HipassCard[]>([]);
    const [records, setRecords] = useState<HipassCharge[]>([]);
    const [loading, setLoading] = useState(true);

    const { confirm } = useConfirm();
    const { showToast } = useToast();

    // 초기 데이터 로드 (관리자: 모든 기록 / 직원: 차량과 카드 목록만)
    useEffect(() => {
        if (!orgId) { setLoading(false); return; }
        
        let isMounted = true;
        setLoading(true);

        const fetchInitial = async () => {
            try {
                if (isAdmin) {
                    const [vReq, rReq] = await Promise.allSettled([
                        getVehicles(orgId),
                        getAllHipassCharges(orgId)
                    ]);
                    if (isMounted && vReq.status === 'fulfilled') setVehicles(vReq.value as Vehicle[]);
                    if (isMounted && rReq.status === 'fulfilled') setRecords(rReq.value as HipassCharge[]);
                } else {
                    const [cReq, vReq] = await Promise.allSettled([
                        getHipassCards(orgId),
                        getVehicles(orgId)
                    ]);
                    if (isMounted && cReq.status === 'fulfilled') setCards(cReq.value as HipassCard[]);
                    if (isMounted && vReq.status === 'fulfilled') setVehicles(vReq.value as Vehicle[]);
                }
            } catch (err) {
                console.error('하이패스 초기 데이터 로드 실패:', err);
            } finally {
                if (isMounted) setLoading(false);
            }
        };
        fetchInitial();

        return () => { isMounted = false; };
    }, [orgId, isAdmin]);

    // 직원용 records 조회 (선택된 카드 기반)
    const loadRecordsForCard = useCallback(async (cardId: string) => {
        if (!orgId || !cardId) {
            setRecords([]);
            return;
        }
        try {
            const r = await getHipassCharges(orgId, cardId);
            setRecords(r as HipassCharge[]);
        } catch (err) {
            console.warn('충전 기록 로드 실패:', err);
            setRecords([]);
        }
    }, [orgId]);

    // 합산 유틸리티
    const calculateTotalCharge = useCallback((targetRecords: HipassCharge[]) => {
        return targetRecords.reduce((sum, r) => sum + (r.chargeAmount || 0), 0);
    }, []);

    // 공통 삭제 로직 (잔액 롤백 옵션 지원)
    const handleDeleteBase = useCallback(async (
        rec: HipassCharge,
        deleteOptions?: {
            checkingUid?: string;
            rollbackBalance?: boolean;
            onSuccess?: () => void;
        }
    ) => {
        const { checkingUid, rollbackBalance, onSuccess } = deleteOptions || {};

        if (checkingUid && rec.chargerUid !== checkingUid) {
            showToast('본인의 충전 기록만 삭제할 수 있습니다.', 'warning');
            return false;
        }

        const msg = rollbackBalance 
            ? '이 충전 기록을 삭제하시겠습니까?\n카드 잔액이 원래대로 되돌아갑니다.' 
            : '이 충전 기록을 삭제하시겠습니까?';

        if (!await confirm({ message: msg, confirmColor: 'danger' })) return false;

        try {
            await deleteHipassCharge(rec.id);

            // 잔액 복원 업데이트
            if (rollbackBalance) {
                setCards(prevCards => {
                    const card = prevCards.find(c => c.id === rec.cardId);
                    if (card) {
                        const newBalance = Math.max(0, card.balance - rec.chargeAmount);
                        // 백그라운드 DB 업데이트 (에러처리만 가볍게)
                        updateHipassCard(card.id, { balance: newBalance }).catch(console.error);
                        return prevCards.map(c => c.id === card.id ? { ...c, balance: newBalance } : c);
                    }
                    return prevCards;
                });
            }

            setRecords(prev => prev.filter(r => r.id !== rec.id));
            showToast('충전 기록이 삭제되었습니다.', 'success');
            onSuccess?.();
            return true;
        } catch (err) {
            console.error('삭제 실패:', err);
            showToast('삭제에 실패했습니다.', 'error');
            return false;
        }
    }, [confirm, showToast]);

    return {
        vehicles, setVehicles,
        cards, setCards,
        records, setRecords,
        loading, setLoading,
        loadRecordsForCard,
        calculateTotalCharge,
        handleDeleteBase
    };
}
