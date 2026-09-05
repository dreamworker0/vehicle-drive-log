/**
 * actions/cancelActions.ts
 * 예약 취소 (handleCancel) — 단건 / 다일 그룹 / 반복 그룹 취소 처리
 */
import {
    cancelReservation,
    cancelReservationGroup,
    cancelRecurringGroup,
} from '../../../lib/firestore';
import { invalidateDashboardCache } from '../../useTodayDashboard';
import type { CancelDeps } from './types';
import type { Reservation } from '../../../types/reservation';

/**
 * 그룹 취소의 낙관적 갱신 — **활성 예약만** 취소됨으로 바꾼다.
 *
 * 서버는 완료·취소된 건을 건드리지 않는데(batchGroupAction의 active 필터) 화면에서만
 * 전부 취소됨으로 칠하면, 이미 운행한 날까지 "취소됨"으로 보였다가 새로고침에서 되돌아온다.
 * 조기 반납으로 한 그룹에 완료와 취소가 섞이는 것이 이제 흔한 모양이라 눈에 띈다.
 */
const markCancelledIfActive = (r: Reservation, inGroup: boolean): Reservation =>
    inGroup && r.status !== 'completed' && r.status !== 'cancelled'
        ? { ...r, status: 'cancelled' as Reservation['status'] }
        : r;

export async function handleCancel(id: string, deps: CancelDeps) {
    const { reservations, userData, showToast, confirm, setReservations } = deps;
    const target = reservations.find(r => r.id === id);

    // ── 반복 예약 취소 ──
    if (target?.recurringGroupId) {
        const rGroupId = target.recurringGroupId;
        const groupCount = reservations.filter(r => r.recurringGroupId === rGroupId && r.status !== 'cancelled' && r.status !== 'completed').length;

        const choice = await confirm({
            title: '반복 예약 취소',
            message: `이 예약은 반복 예약 그룹(${groupCount}건)의 일부입니다.\n\n이 날짜만 취소하시겠습니까, 아니면 전체 반복 예약을 취소하시겠습니까?`,
            confirmText: '전체 취소',
            cancelText: '이 날짜만',
            confirmColor: 'danger',
        });

        if (choice === null || choice === undefined) return; // 다이얼로그 닫기

        try {
            if (choice) {
                // 전체 취소
                const cancelled = await cancelRecurringGroup(rGroupId, userData?.organizationId || '');
                if (cancelled === 0) {
                    showToast('취소할 예약이 없습니다. 이미 완료되었거나 취소된 예약입니다.', 'error');
                    return;
                }
                showToast(`반복 예약 ${cancelled}건이 취소되었습니다.`);
                setReservations(prev => prev.map(r => markCancelledIfActive(r, r.recurringGroupId === rGroupId)));
                invalidateDashboardCache();
            } else {
                // 이 날짜만 취소
                await cancelReservation(id);
                showToast('해당 날짜의 예약이 취소되었습니다.');
                setReservations(prev => prev.map(r => r.id === id ? { ...r, status: 'cancelled' } : r));
                invalidateDashboardCache();
            }
        } catch (error: unknown) {
            const errMsg = error instanceof Error ? error.message : '취소에 실패했습니다.';
            showToast(errMsg, 'error');
        }
        return;
    }

    // ── 연속 다일 예약 취소 ──
    const groupId = target?.groupId;

    if (groupId) {
        // 그룹 예약: 전체 취소 확인
        const groupCount = reservations.filter(r => r.groupId === groupId && r.status !== 'cancelled' && r.status !== 'completed').length;
        // 취소할 것이 없으면 묻지도 않는다 — "이 예약은 0일간 다일 예약의 일부입니다"를
        // 띄워 놓고 확인을 받아 봐야 서버에는 아무것도 쓰지 않는다.
        if (groupCount === 0) {
            showToast('취소할 예약이 없습니다. 이미 완료되었거나 취소된 예약입니다.', 'error');
            return;
        }
        const choice = await confirm({
            title: '다일 예약 취소',
            message: `이 예약은 ${groupCount}일간 다일 예약의 일부입니다.\n\n전체 다일 예약을 취소하시겠습니까?`,
            confirmText: '전체 취소',
            cancelText: '돌아가기',
            confirmColor: 'danger',
        });

        if (!choice) return;

        try {
            const cancelled = await cancelReservationGroup(groupId, userData?.organizationId || '');
            // 0건이면 취소된 것이 없다 — 그룹이 이미 전부 완료·취소된 상태다.
            // 예전에는 "0건이 취소되었습니다"를 띄우고 **화면만 취소된 것처럼 바꿨다.**
            // 새로고침하면 예약이 그대로 돌아와, 사용자는 취소가 됐다고 믿은 채 차량이
            // 계속 잡혀 있는 것을 나중에야 알게 된다. 쓰지 않았으면 바꾸지도 않는다.
            if (cancelled === 0) {
                showToast('취소할 예약이 없습니다. 이미 완료되었거나 취소된 예약입니다.', 'error');
                return;
            }
            showToast(`다일 예약 ${cancelled}건이 취소되었습니다.`);
            setReservations(prev => prev.map(r => markCancelledIfActive(r, r.groupId === groupId)));
            invalidateDashboardCache();
        } catch (error: unknown) {
            const errMsg = error instanceof Error ? error.message : '취소에 실패했습니다.';
            showToast(errMsg, 'error');
        }
    } else {
        // 단일 예약: 기존 로직
        if (!await confirm({ message: '예약을 취소하시겠습니까?', confirmColor: 'danger' })) return;

        try {
            await cancelReservation(id);
            showToast('예약이 취소되었습니다.');
            setReservations(prev => prev.filter(r => r.id !== id));
            invalidateDashboardCache();
        } catch (error: unknown) {
            const errMsg = error instanceof Error ? error.message : '취소에 실패했습니다.';
            showToast(errMsg, 'error');
        }
    }
}
