import { useState, useEffect, useCallback } from 'react';
import type { Vehicle } from '../../types/vehicle';
import type { HipassCharge } from '../../types/hipassCharge';
import type { HipassCard } from '../../types/hipass';
import { 
    getVehicles, 
    getHipassCards, 
    getAllHipassCharges, 
    getHipassCharges, 
    deleteHipassCharge
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

            // 잔액 되돌리기는 **서버가 한다** — 기록이 지워지면 onHipassChargeDeleted가
            // 트랜잭션으로 뺀다(Phase 227). 여기서 함께 쓰면 이중 반영이 되고, 화면에 로드된
            // 오래된 값으로 덮어써 남의 갱신을 지우는 문제도 있었다.
            //
            // 그래도 카드를 찾는 이유는 두 가지다. ① 화면을 즉시 맞춰 주고(다음 조회에서 서버
            // 값으로 수렴한다) ② 확인창이 "잔액이 되돌아갑니다"라고 약속했으므로, **카드가 이미
            // 삭제돼 되돌릴 곳이 없으면** 성공이라고 말하지 않는다(Phase 225에서 닫은 구멍).
            const card = rollbackBalance ? cards.find(c => c.id === rec.cardId) : undefined;
            const balanceRolledBack = !rollbackBalance || Boolean(card);
            if (card) {
                const newBalance = Math.max(0, card.balance - rec.chargeAmount);
                setCards(prev => prev.map(c => (c.id === card.id ? { ...c, balance: newBalance } : c)));
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
