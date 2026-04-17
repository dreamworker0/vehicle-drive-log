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
                showToast(`반복 예약 ${cancelled}건이 취소되었습니다.`);
                setReservations(prev => prev.map(r => r.recurringGroupId === rGroupId ? { ...r, status: 'cancelled' } : r));
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
            showToast(`다일 예약 ${cancelled}건이 취소되었습니다.`);
            setReservations(prev => prev.map(r => r.groupId === groupId ? { ...r, status: 'cancelled' } : r));
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
