import { useState, useEffect } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../hooks/useToast';
import { subscribePendingReservations, updateReservationStatus } from '../../lib/firestore/reservations';
import { getVehicles } from '../../lib/firestore/vehicles';
import type { Vehicle } from '../../types/vehicle';
import { getOrganizationMembers } from '../../lib/firestore/users';
import type { DocumentData } from 'firebase/firestore';

export default function PendingReservationList() {
    const { userData } = useAuth();
    const [pendingList, setPendingList] = useState<(DocumentData & { id: string })[]>([]);
    const [vehicles, setVehicles] = useState<Vehicle[]>([]);
    const [employees, setEmployees] = useState<Record<string, { displayName: string; department?: string }>>({});
    const { showToast } = useToast();
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!userData?.organizationId) return;
        const unsub = subscribePendingReservations(userData.organizationId, (data) => {
            setPendingList(data);
            setLoading(false);
        });
        return () => unsub();
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
                    empMap[e.uid || e.id] = { displayName: e.displayName || e.name, department: e.department };
                });
                setEmployees(empMap);
            } catch (error) {
                console.error("Failed to load generic data", error);
            }
        };

        fetchData();
    }, [userData?.organizationId]);

    const handleApprove = async (id: string) => {
        try {
            await updateReservationStatus(id, 'reserved');
        } catch (error) {
            console.error('Failed to approve reservation', error);
            showToast('예약 승인에 실패했습니다.', 'error');
        }
    };

    const handleReject = async (id: string) => {
        const reason = window.prompt('반려 사유를 입력해주세요 (선택사항):');
        if (reason === null) return; // 취소 누름

        try {
            await updateReservationStatus(id, 'rejected', {
                rejectedReason: reason,
                rejectedAt: new Date().toISOString()
            });
        } catch (error) {
            console.error('Failed to reject reservation', error);
            showToast('예약 반려 처리에 실패했습니다.', 'error');
        }
    };

    if (loading) return null;
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
                            <div key={res.id} className="p-4 sm:flex items-center justify-between gap-4">
                                <div className="space-y-1 mb-4 sm:mb-0">
                                    <div className="flex items-center gap-2 text-sm">
                                        <span className="inline-block px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 text-xs font-medium transition-colors duration-300">
                                            {reserver?.department ? `${reserver.department} ` : ''}
                                            {reserver?.displayName || res.reservedByName}
                                        </span>
                                        <span className="font-semibold text-surface-900 dark:text-surface-100 transition-colors duration-300">
                                            {vehicle?.name || res.vehicleId}
                                        </span>
                                    </div>
                                    <div className="text-sm text-surface-600 dark:text-surface-400 transition-colors duration-300">
                                        ⏱️ {res.date} ({res.startTime} ~ {res.endTime})
                                    </div>
                                    <div className="text-sm text-surface-500 dark:text-surface-500 transition-colors duration-300 flex items-start gap-1">
                                        <svg className="w-4 h-4 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z" />
                                        </svg>
                                        <span className="flex-1">{res.destination} {res.reason && `- ${res.reason}`}</span>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() => handleReject(res.id)}
                                        className="btn-outline flex-1 sm:flex-none border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700 dark:border-red-900/30 dark:text-red-400 dark:hover:bg-red-900/20 dark:hover:text-red-300 transition-colors duration-300"
                                    >
                                        반려
                                    </button>
                                    <button
                                        onClick={() => handleApprove(res.id)}
                                        className="btn-primary flex-1 sm:flex-none"
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
