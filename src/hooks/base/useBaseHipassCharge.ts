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
                    // 카드까지 읽는 이유: 관리자가 충전금액을 정정하면 카드 잔액도 그만큼
                    // 어긋난다. 잔액을 함께 맞추려면 현재 잔액을 알고 있어야 한다.
                    const [vReq, rReq, cReq] = await Promise.allSettled([
                        getVehicles(orgId),
                        getAllHipassCharges(orgId),
                        getHipassCards(orgId)
                    ]);
                    if (isMounted && vReq.status === 'fulfilled') setVehicles(vReq.value as Vehicle[]);
                    if (isMounted && rReq.status === 'fulfilled') setRecords(rReq.value as HipassCharge[]);
                    if (isMounted && cReq.status === 'fulfilled') setCards(cReq.value as HipassCard[]);
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

            // 잔액 복원 — 상태 업데이터 **밖에서** 계산한다.
            // 예전에는 `setCards(prev => ...)` 안에서 Firestore 쓰기를 불렀는데, 업데이터는
            // 순수해야 한다(StrictMode는 개발 중 두 번 실행한다 — 쓰기도 두 번 나간다).
            let balanceRolledBack = true;
            const card = rollbackBalance ? cards.find(c => c.id === rec.cardId) : undefined;
            if (card) {
                const newBalance = Math.max(0, card.balance - rec.chargeAmount);
                try {
                    await updateHipassCard(card.id, { balance: newBalance });
                    setCards(prev => prev.map(c => (c.id === card.id ? { ...c, balance: newBalance } : c)));
                } catch (err) {
                    // 기록 삭제는 이미 성공했다 — 통째로 "삭제 실패"라고 하면 거짓말이 된다.
                    balanceRolledBack = false;
                    console.error('카드 잔액 되돌리기 실패:', err);
                }
            }

            setRecords(prev => prev.filter(r => r.id !== rec.id));
            if (balanceRolledBack) {
                showToast('충전 기록이 삭제되었습니다.', 'success');
            } else {
                showToast('기록은 삭제됐지만 카드 잔액을 되돌리지 못했습니다. [하이패스 관리]에서 잔액을 확인해주세요.', 'warning');
            }
            onSuccess?.();
            return true;
        } catch (err) {
            console.error('삭제 실패:', err);
            showToast('삭제에 실패했습니다.', 'error');
            return false;
        }
        // cards가 의존성에 있는 이유: 잔액 계산을 상태 업데이터 밖으로 뺐기 때문이다.
        // 이벤트 핸들러는 직전 렌더의 값을 보는데, React는 다음 이벤트 전에 렌더를 끝내므로
        // 여기서 읽는 cards는 화면에 보이는 잔액과 같다.
    }, [cards, confirm, showToast]);

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
