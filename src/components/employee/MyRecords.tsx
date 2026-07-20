import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { getMyDriveLogs } from '../../lib/firestore';
import { VEHICLE_TYPE_ICONS, getVehicleColor } from '../../lib/constants';
import { formatTimestampShort } from '../../lib/dateUtils';
import { SkeletonBox, SkeletonList } from '../common/Skeleton';
import MyStatsSummary from './MyStatsSummary';
import type { DriveLog } from '../../types/driveLog';

export default function MyRecords() {
    const { user, userData } = useAuth();
    const navigate = useNavigate();
    const [logs, setLogs] = useState<DriveLog[]>([]);
    const [loading, setLoading] = useState(true);
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [showSearch, setShowSearch] = useState(false);
    const searchInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (!user?.uid || !userData?.organizationId) { setLoading(false); return; }
        const fetch = async () => {
            try {
                const data = await getMyDriveLogs(userData.organizationId!, user.uid, 50);
                setLogs(data as DriveLog[]);
            } catch (err) {
                console.error('기록 로드 실패:', err);
            } finally {
                setLoading(false);
            }
        };
        fetch();
    }, [user?.uid, userData?.organizationId]);

    const filteredLogs = useMemo(() => {
        if (!searchQuery.trim()) return logs;
        const q = searchQuery.trim().toLowerCase();
        return logs.filter(log =>
            (log.vehicleName || '').toLowerCase().includes(q) ||
            (log.destination || '').toLowerCase().includes(q) ||
            (log.purpose || '').toLowerCase().includes(q) ||
            (log.notes || '').toLowerCase().includes(q)
        );
    }, [logs, searchQuery]);

    const grouped = filteredLogs.reduce<Record<string, DriveLog[]>>((acc, log) => {
        const ts = log.timestamp;
        const key = (ts && typeof ts === 'object' && 'toDate' in ts && typeof ts.toDate === 'function')
            ? ts.toDate().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long' })
            : '기타';
        if (!acc[key]) acc[key] = [];
        acc[key].push(log);
        return acc;
    }, {});

    if (loading) {
        return (
            <div className="max-w-lg mx-auto animate-fade-in">
                <SkeletonBox className="h-6 w-24 mb-2" />
                <SkeletonBox className="h-4 w-36 mb-4" />
                <SkeletonList count={5} />
            </div>
        );
    }

    const totalDistance = filteredLogs.reduce((sum, l) => sum + ((l.endKm - l.startKm) || 0), 0);

    const handleToggleSearch = () => {
        setShowSearch(prev => {
            if (!prev) setTimeout(() => searchInputRef.current?.focus(), 100);
            else setSearchQuery('');
            return !prev;
        });
    };

    return (
        <div className="max-w-lg mx-auto animate-fade-in">
            <div className="flex items-center justify-between mb-2">
                <h1 className="text-lg font-bold text-surface-900 dark:text-surface-100">내 기록</h1>
                <button onClick={handleToggleSearch} className={`p-2 min-h-[48px] min-w-[48px] flex items-center justify-center rounded-xl transition-colors ${showSearch ? 'bg-primary-100 dark:bg-primary-900/40 text-primary-600 dark:text-primary-400 dark:bg-primary-900/40 dark:text-primary-400' : 'text-surface-400 dark:text-surface-500 hover:text-surface-600 hover:bg-surface-100 dark:hover:bg-surface-700'}`} aria-label="검색">
                    <svg aria-hidden="true" className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" /></svg>
                </button>
            </div>

            {showSearch && (
                <div className="relative mb-3 animate-fade-in">
                    <svg aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-400 dark:text-surface-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" /></svg>
                    <input ref={searchInputRef} type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="차량명, 행선지, 목적, 비고 검색…" className="w-full pl-9 pr-9 py-2.5 min-h-[48px] rounded-xl bg-surface-100 dark:bg-surface-700 text-sm text-surface-900 dark:text-surface-100 placeholder-surface-400 border border-surface-200 dark:border-surface-600 focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500 transition-colors" />
                    {searchQuery && (
                        <button onClick={() => setSearchQuery('')} className="absolute right-1 top-1/2 -translate-y-1/2 text-surface-400 dark:text-surface-500 hover:text-surface-600 dark:hover:text-surface-300 min-h-[48px] min-w-[48px] flex items-center justify-center">
                            <svg aria-hidden="true" className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
                        </button>
                    )}
                </div>
            )}

            {/* 월간 통계 요약 */}
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            <MyStatsSummary logs={logs as any} />

            <p className="text-sm text-surface-500 dark:text-surface-400 mb-4">
                {searchQuery ? `검색 결과 ${filteredLogs.length}건` : `총 ${logs.length}건`} · {totalDistance.toLocaleString()} km
            </p>

            {/* 누락 운행 소급 입력 진입점 — 예약 없이 지난 운행을 직접 기록 */}
            {!searchQuery && (
                <button
                    onClick={() => navigate('/employee/drive-log', { state: { retroactive: true } })}
                    className="w-full mb-4 py-3 min-h-[48px] rounded-xl border border-dashed border-surface-300 dark:border-surface-600 text-sm font-medium text-surface-500 dark:text-surface-400 hover:border-primary-400 dark:hover:border-primary-500 hover:text-primary-600 dark:hover:text-primary-400 transition-colors flex items-center justify-center gap-1.5"
                >
                    <svg aria-hidden="true" className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
                    누락 운행 입력
                </button>
            )}

            {filteredLogs.length === 0 ? (
                <div className="glass-card p-12 text-center">
                    <div className="text-4xl mb-3">{searchQuery ? '🔍' : '📋'}</div>
                    <p className="text-surface-400 dark:text-surface-500 font-medium">{searchQuery ? `"${searchQuery}" 검색 결과가 없습니다` : '아직 운행 기록이 없어요'}</p>
                    <p className="text-xs text-surface-300 dark:text-surface-500 mt-1">{searchQuery ? '다른 키워드로 검색해보세요' : '예약 후 운행을 시작하면 여기에 기록이 쌓여요'}</p>
                    {!searchQuery && (
                        <button
                            onClick={() => navigate('/employee/reservations')}
                            className="mt-4 btn-primary btn-sm text-sm min-h-[48px]"
                        >
                            📅 예약하러 가기
                        </button>
                    )}
                </div>
            ) : (
                <div className="space-y-6">
                    {Object.entries(grouped).map(([month, monthLogs]) => (
                        <div key={month}>
                            <h2 className="text-sm font-semibold text-surface-500 dark:text-surface-400 mb-3 sticky top-0 bg-surface-50 dark:bg-surface-800 py-1 z-10">{month}</h2>
                            <div className="space-y-2">
                                {monthLogs.map((log: DriveLog) => (
                                    <div key={log.id} className="glass-card overflow-hidden transition-all duration-200">
                                        <button onClick={() => setExpandedId(expandedId === log.id ? null : log.id)} className="w-full p-4 text-left flex items-center gap-3 group">
                                            <div className={`w-10 h-10 rounded-xl ${log.vehicleId ? getVehicleColor(log.vehicleId) : 'bg-primary-50 dark:bg-primary-900/30'} flex items-center justify-center text-lg flex-shrink-0`}>{VEHICLE_TYPE_ICONS[log.vehicleType ?? ''] || '🚗'}</div>
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-1.5 flex-wrap">
                                                    <p className="font-medium text-sm text-surface-900 dark:text-surface-100 truncate">{log.vehicleName || '차량'}</p>
                                                    <span className="text-xs text-surface-400 dark:text-surface-500">{formatTimestampShort(log.timestamp)}{(log.startTime || log.endTime) && ` ${log.startTime || '--:--'}~${log.endTime || '--:--'}`}</span>
                                                    {log.isRetroactive && <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-orange-100 text-orange-600 dark:bg-orange-900/40 dark:text-orange-400">소급</span>}
                                                    {log.editedAt && <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-400">수정됨</span>}
                                                </div>
                                                <div className="flex items-center gap-2 mt-0.5">
                                                    {log.destination && <span className="text-xs text-surface-500 dark:text-surface-400">{log.destination}</span>}
                                                    {log.destination && log.purpose && <span className="text-xs text-surface-300 dark:text-surface-600">·</span>}
                                                    {log.purpose && <span className="text-xs text-surface-500 dark:text-surface-400">{log.purpose}</span>}
                                                    {!log.purpose && !log.destination && <span className="text-xs text-surface-400 dark:text-surface-500">-</span>}
                                                </div>
                                            </div>
                                            <div className="text-right flex-shrink-0 flex flex-col items-end gap-1">
                                                <p className="text-sm font-bold text-primary-600 dark:text-primary-400">{((log.endKm - log.startKm) || 0).toLocaleString()} km</p>
                                                <div className="flex items-center text-xs text-surface-400 dark:text-surface-500 gap-0.5 group-hover:text-primary-500 transition-colors">
                                                    <span>수정·상세</span>
                                                    <svg aria-hidden="true" className={`w-3.5 h-3.5 transition-transform duration-200 ${expandedId === log.id ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" /></svg>
                                                </div>
                                            </div>
                                        </button>
                                        {expandedId === log.id && (
                                            <div className="px-4 pb-4 border-t border-surface-100 dark:border-surface-700 pt-3 animate-fade-in">
                                                <div className="grid grid-cols-2 gap-3 text-sm">
                                                    <div><span className="text-xs text-surface-400 dark:text-surface-500">출발 km</span><p className="font-mono text-surface-700 dark:text-surface-300">{log.startKm?.toLocaleString()} km</p></div>
                                                    <div><span className="text-xs text-surface-400 dark:text-surface-500">도착 km</span><p className="font-mono text-surface-700 dark:text-surface-300">{log.endKm?.toLocaleString()} km</p></div>
                                                    {(log.startTime || log.endTime) && (<div className="col-span-2"><span className="text-xs text-surface-400 dark:text-surface-500">운행 시각</span><p className="text-surface-700 dark:text-surface-300 font-mono">{log.startTime || '--:--'} → {log.endTime || '--:--'}</p></div>)}
                                                    {log.purpose && (<div><span className="text-xs text-surface-400 dark:text-surface-500">운행 목적</span><p className="text-surface-700 dark:text-surface-300">{log.purpose}</p></div>)}
                                                    {log.destination && (<div><span className="text-xs text-surface-400 dark:text-surface-500">행선지</span><p className="text-surface-700 dark:text-surface-300">{log.destination}</p></div>)}
                                                    {log.fuelAmount && (<div><span className="text-xs text-surface-400 dark:text-surface-500">주유비</span><p className="text-surface-700 dark:text-surface-300">{Number(log.fuelAmount).toLocaleString()}원</p></div>)}
                                                    {log.batteryStart != null && (<div className="col-span-2"><span className="text-xs text-surface-400 dark:text-surface-500">배터리</span><p className="text-surface-700 dark:text-surface-300">🔋 {log.batteryStart}% → {log.batteryEnd}%</p></div>)}
                                                    {(log.coDriverNames?.length ?? 0) > 0 && (<div className="col-span-2"><span className="text-xs text-surface-400 dark:text-surface-500">공동 운전자</span><p className="text-surface-700 dark:text-surface-300">🤝 {log.coDriverNames!.join(', ')}</p></div>)}
                                                    {(log.passengerCount ?? 0) > 0 && (<div className="col-span-2"><span className="text-xs text-surface-400 dark:text-surface-500">탑승인원</span><p className="text-surface-700 dark:text-surface-300">👥 {log.passengerCount}명{(log.passengerNames?.length ?? 0) > 0 && (<span className="text-xs text-surface-400 dark:text-surface-500 ml-1">({log.passengerNames!.join(', ')})</span>)}</p></div>)}
                                                    {log.notes && (<div className="col-span-2"><span className="text-xs text-surface-400 dark:text-surface-500">비고</span><p className="text-surface-700 dark:text-surface-300">{log.notes}</p></div>)}
                                                </div>
                                                <div className="flex gap-2 mt-3">
                                                    <button onClick={() => navigate('/employee/drive-log', { state: { editLog: log } })} className="btn-soft-blue flex-1 text-sm min-h-[48px] flex items-center justify-center gap-1">
                                                        <svg aria-hidden="true" className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" /></svg>
                                                        수정
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
