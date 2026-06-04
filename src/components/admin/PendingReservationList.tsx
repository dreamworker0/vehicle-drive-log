import { useState, useEffect } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../hooks/useToast';
import { useConfirmStore } from '../../store/useConfirmStore';
import useRetry from '../../hooks/useRetry';
import { getPendingReservations, updateReservationStatus } from '../../lib/firestore/reservations';
import { getVehicles } from '../../lib/firestore/vehicles';
import type { Vehicle } from '../../types/vehicle';
import { getOrganizationMembers } from '../../lib/firestore/users';
import { serverTimestamp } from 'firebase/firestore';
import type { DocumentData } from 'firebase/firestore';

export default function PendingReservationList() {
    const { userData } = useAuth();
    const [pendingList, setPendingList] = useState<(DocumentData & { id: string })[]>([]);
    const [vehicles, setVehicles] = useState<Vehicle[]>([]);
    const [employees, setEmployees] = useState<Record<string, { displayName: string; department?: string }>>({});
    
    const { showToast } = useToast();
    const confirm = useConfirmStore(state => state.confirm);
    const { runWithRetry } = useRetry();

    const [pendingLoading, setPendingLoading] = useState(true);
    const [dataLoading, setDataLoading] = useState(true);

    useEffect(() => {
        if (!userData?.organizationId) return;
        
        const loadPending = async () => {
            try {
                const data = await getPendingReservations(userData.organizationId!);
                setPendingList(data);
            } catch (error) {
                console.error("Failed to load pending reservations:", error);
            } finally {
                setPendingLoading(false);
            }
        };

        loadPending();
    }, [userData?.organizationId]);

    useEffect(() => {
        if (!userData?.organizationId) return;
        
        const fetchData = async () => {
            try {
                const [vList, empData] = await Promise.all([
                    getVehicles(userData.organizationId!),
                    getOrganizationMembers(userData.organizationId!)
                ]);
                
                setVehicles(vList);
                const empMap: Record<string, { displayName: string; department?: string }> = {};
                empData.forEach(e => {
                    const extra = e as Record<string, unknown>;
                    const uid = (extra.uid || extra.id) as string;
                    if (uid) {
                        empMap[uid] = { 
                            displayName: (extra.displayName || extra.name) as string, 
                            department: extra.department as string | undefined 
                        };
                    }
                });
                setEmployees(empMap);
            } catch (error) {
                console.error("Failed to load generic data", error);
                showToast('차량 및 직원 정보를 불러오는데 실패했습니다.', 'error');
            } finally {
                setDataLoading(false);
            }
        };

        fetchData();
    }, [userData?.organizationId, showToast]);

    const handleApprove = async (id: string) => {
        await runWithRetry(`approve-res-${id}`, async () => {
            await updateReservationStatus(id, 'reserved', {}, 'pending');
            setPendingList(prev => prev.filter(r => r.id !== id));
            showToast('예약이 승인되었습니다.', 'success');
        }, {
            errorMessage: '예약 승인에 실패했습니다.',
            onError: (error: unknown) => {
                if (error instanceof Error && error.message.includes('동시성 오류')) {
                    showToast('이미 처리되어 상태가 변경된 예약입니다.', 'error');
                    return true;
                }
            }
        });
    };

    const handleReject = async (id: string) => {
        const reason = await confirm({
            type: 'input',
            title: '예약 반려',
            message: '예약을 반려하시겠습니까? 반려 사유를 입력해주세요 (선택사항):',
            inputPlaceholder: '예: 부적절한 사용 목적',
            confirmColor: 'danger',
            confirmText: '반려',
            cancelText: '취소'
        });

        if (reason === false || reason === null) return; // 취소 누름

        await runWithRetry(`reject-res-${id}`, async () => {
            await updateReservationStatus(id, 'rejected', {
                rejectedReason: reason as string,
                rejectedAt: serverTimestamp()
            } as Record<string, unknown>, 'pending');
            setPendingList(prev => prev.filter(r => r.id !== id));
            showToast('예약이 반려되었습니다.', 'success');
        }, {
            errorMessage: '예약 반려 처리에 실패했습니다.',
            onError: (error: unknown) => {
                if (error instanceof Error && error.message.includes('동시성 오류')) {
                    showToast('이미 처리되어 상태가 변경된 예약입니다.', 'error');
                    return true;
                }
            }
        });
    };

    if (pendingLoading || dataLoading) return null;
    if (pendingList.length === 0) return null;

    return (
        <div className="mb-8">
            <div className="bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-900/30 rounded-xl overflow-hidden shadow-sm animate-fade-in transition-colors duration-300">
                <div className="p-4 border-b border-amber-200 dark:border-amber-900/30 bg-amber-100/50 dark:bg-amber-900/20 flex items-center justify-between transition-colors duration-300">
                    <div className="flex items-center gap-2">
                        <svg className="w-5 h-5 text-amber-600 dark:text-amber-500 transition-colors duration-300" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2.25m0 2.25h.01M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25Z" />
                        </svg>
                        <h2 className="font-semibold text-amber-900 dark:text-amber-200 transition-colors duration-300">
                            승인 대기 중인 예약 ({pendingList.length}건)
                        </h2>
                    </div>
                </div>
                <div className="divide-y divide-amber-200/50 dark:divide-amber-900/30 transition-colors duration-300">
                    {pendingList.map(res => {
                        const vehicle = vehicles.find(v => v.id === res.vehicleId);
                        const reserver = employees[res.reservedByUid];
                        return (
                            <div key={res.id} className="p-4 sm:flex items-center justify-between gap-4 group hover:bg-amber-50/50 dark:hover:bg-amber-900/10 transition-colors duration-300">
                                <div className="space-y-2.5 mb-4 sm:mb-0 w-full overflow-hidden">
                                    <div className="flex flex-wrap items-center gap-2 text-sm">
                                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-surface-100 dark:bg-surface-800 text-surface-800 dark:text-surface-200 text-xs font-medium transition-colors duration-300 shadow-sm border border-surface-200/50 dark:border-surface-700/50">
                                            <svg className="w-3.5 h-3.5 text-surface-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
                                            </svg>
                                            {reserver?.department ? `${reserver.department} ` : ''}
                                            {reserver?.displayName || res.reservedByName}
                                        </span>
                                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-indigo-50 dark:bg-indigo-900/30 text-indigo-800 dark:text-indigo-200 text-xs font-semibold transition-colors duration-300 shadow-sm border border-indigo-200/50 dark:border-indigo-800/30">
                                            <svg className="w-4 h-4 text-indigo-500 dark:text-indigo-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 0 1-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 0 0-3.213-9.193 2.056 2.056 0 0 0-1.58-.86H14.25M16.5 18.75h-2.25m0-11.177v-.958c0-.568-.422-1.048-.987-1.106a48.554 48.554 0 0 0-10.026 0 1.106 1.106 0 0 0-.987 1.106v7.635m12-6.677v6.677m0 4.5v-4.5m0 0h-12" />
                                            </svg>
                                            <span className="truncate max-w-[120px] sm:max-w-[200px]">
                                                {vehicle?.name || res.vehicleName || '알 수 없는 차량 정보'}
                                            </span>
                                        </span>
                                    </div>
                                    <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 ml-1">
                                        <div className="text-sm font-medium text-surface-700 dark:text-surface-300 transition-colors duration-300 flex items-center gap-2">
                                            <div className="p-1 rounded-full bg-amber-100 dark:bg-amber-900/40">
                                                <svg className="w-3.5 h-3.5 text-amber-600 dark:text-amber-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                                                </svg>
                                            </div>
                                            {res.date} ({res.startTime} ~ {res.endTime})
                                        </div>
                                        <div className="hidden sm:block w-1 h-1 rounded-full bg-surface-300 dark:bg-surface-600"></div>
                                        <div className="text-sm text-surface-600 dark:text-surface-400 transition-colors duration-300 flex items-start gap-2">
                                            <svg className="w-4 h-4 mt-0.5 shrink-0 text-surface-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z" />
                                            </svg>
                                            <span className="flex-1 break-keep leading-tight mt-0.5">
                                                <span className="font-medium">{res.destination}</span>
                                                {res.reason && <span className="text-surface-400 dark:text-surface-500 font-normal"> - {res.reason}</span>}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2 mt-4 sm:mt-0 shrink-0 border-t border-surface-100 dark:border-surface-800 sm:border-0 pt-4 sm:pt-0">
                                    <button
                                        onClick={() => handleReject(res.id)}
                                        className="btn-outline flex-1 sm:flex-none h-9 px-4 text-sm border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700 hover:border-red-300 dark:border-red-900/40 dark:text-red-400 dark:hover:bg-red-900/20 dark:hover:text-red-300 dark:hover:border-red-800/50 transition-all duration-300"
                                    >
                                        반려
                                    </button>
                                    <button
                                        onClick={() => handleApprove(res.id)}
                                        className="btn-primary flex-1 sm:flex-none h-9 px-5 text-sm shadow-sm hover:shadow-md transition-all duration-300"
                                    >
                                        승인
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}

