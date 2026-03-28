/**
 * useReservationPattern — 사용자의 과거 예약 데이터를 분석하여 다음 패턴을 추천하는 커스텀 훅
 */
import { useState, useEffect } from 'react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from './useAuth';
import { getMyRecentReservations } from '../lib/firestore/reservations';
import { getVehicles } from '../lib/firestore/vehicles';

export interface RecommendedPattern {
    vehicleId: string;
    vehicleName: string;
    date: string;       // YYYY-MM-DD
    startTime: string;  // HH:MM
    endTime: string;    // HH:MM
    destination: string;
    dayOfWeekRaw: number; // 요일 데이터 (0: 일, ~ 6: 토)
}

export function useReservationPattern() {
    const { user, userData } = useAuth();
    const [recommended, setRecommended] = useState<RecommendedPattern[]>([]);
    const [recentDestinations, setRecentDestinations] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);

    const getNextDateForWeekday = (targetWeekday: number): string => {
        const today = new Date();
        const currentWeekday = today.getDay();
        let daysToAdd = targetWeekday - currentWeekday;
        
        // 지난 요일이거나, 오늘과 같은 요일이라면 무조건 다음주로 계산
        if (daysToAdd <= 0) {
            daysToAdd += 7;
        }
        
        const nextDate = new Date(today.getTime() + daysToAdd * 24 * 60 * 60 * 1000);
        const y = nextDate.getFullYear();
        const m = String(nextDate.getMonth() + 1).padStart(2, '0');
        const d = String(nextDate.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    };

    useEffect(() => {
        let mounted = true;
        const orgId = userData?.organizationId;
        const uid = user?.uid;
        
        if (!orgId || !uid) {
            setLoading(false);
            return;
        }

        const analyze = async () => {
            try {
                // 최근 30개의 내 예약을 가져옴
                const recent = await getMyRecentReservations(orgId, uid, 30);
                if (recent.length < 3) {
                    if (mounted) {
                        setRecommended([]);
                        setRecentDestinations([]);
                        setLoading(false);
                    }
                    return;
                }

                // 1. 최근 방문 목적지 (자주 가는 곳 제외, 단순 최근/빈도순 상위 3곳)
                const destCounter = new Map<string, number>();
                recent.forEach(r => {
                    const destLines = (r.destination || '').split(',').map(d => d.trim()).filter(Boolean);
                    destLines.forEach(d => destCounter.set(d, (destCounter.get(d) || 0) + 1));
                });
                const topDests = Array.from(destCounter.entries())
                    .sort((a,b) => b[1] - a[1] || a[0].localeCompare(b[0]))
                    .map(e => e[0])
                    .slice(0, 3);
                
                if (mounted) setRecentDestinations(topDests);

                // 차량별 이용 빈도 집계 (가장 많이 타는 차량 파악용)
                const vehicleCounter = new Map<string, number>();
                for (const r of recent) {
                    if (r.vehicleId) {
                        vehicleCounter.set(r.vehicleId, (vehicleCounter.get(r.vehicleId) || 0) + 1);
                    }
                }

                // 2. 다중 패턴 집계 (일일/주간/다빈도 목적지)
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                type PatternResult = { score: number; count: number; type: 'weekly' | 'daily' | 'dest-weekly' | 'dest-daily'; targetWeekday?: number; reservation: any; times?: string[] };
                const patternMap = new Map<string, PatternResult>();

                for (const r of recent) {
                    if (!r.date || !r.startTime || !r.vehicleId) continue;
                    
                    const d = new Date(r.date + 'T00:00:00');
                    const weekday = d.getDay();
                    const dest = (r.destination || '').trim();
                    const timeWindow = r.startTime;
                    
                    // 1. Weekly (매주 이 요일 + 시간)
                    const wKey = `W_${weekday}_${timeWindow}_${dest}`;
                    const existingW = patternMap.get(wKey);
                    if (existingW) {
                        existingW.count += 1;
                        existingW.score += 1.0;
                    } else {
                        patternMap.set(wKey, { score: 1.0, count: 1, type: 'weekly', targetWeekday: weekday, reservation: r });
                    }

                    // 2. Daily (요일 무관 자주 + 시간)
                    const dKey = `D_${timeWindow}_${dest}`;
                    const existingD = patternMap.get(dKey);
                    if (existingD) {
                        existingD.count += 1;
                        existingD.score += 0.8; 
                    } else {
                        patternMap.set(dKey, { score: 0.8, count: 1, type: 'daily', reservation: r });
                    }

                    // 목적지가 있는 경우 목적지 전용 복합 패턴 추가
                    if (dest) {
                        // 3. Dest-Weekly
                        const dwKey = `DW_${weekday}_${dest}`;
                        const existingDW = patternMap.get(dwKey);
                        if (existingDW) {
                            existingDW.count += 1;
                            existingDW.score += 0.9;
                            existingDW.times?.push(timeWindow);
                        } else {
                            patternMap.set(dwKey, { score: 0.9, count: 1, type: 'dest-weekly', targetWeekday: weekday, reservation: r, times: [timeWindow] });
                        }

                        // 4. Dest-Daily
                        const ddKey = `DD_${dest}`;
                        const existingDD = patternMap.get(ddKey);
                        if (existingDD) {
                            existingDD.count += 1;
                            existingDD.score += 0.6;
                            existingDD.times?.push(timeWindow);
                        } else {
                            patternMap.set(ddKey, { score: 0.6, count: 1, type: 'dest-daily', reservation: r, times: [timeWindow] });
                        }
                    }
                }

                // 점수가 가장 높고 count >= 3 인 상위 2개 추출
                const topPatterns = Array.from(patternMap.values())
                    .filter(item => item.count >= 3)
                    .sort((a, b) => b.score - a.score)
                    .slice(0, 2);

                const finalRecommendations: RecommendedPattern[] = [];
                const vehiclesDataCache = await getVehicles(orgId); // 한 번만 미리 가져와서 여러 패턴에 사용

                for (const bestMatch of topPatterns) {
                    const r = bestMatch.reservation;
                    
                    // 다빈도 목적지 패턴일 경우 가장 빈번한 시간대를 출발 시간으로 산출
                    let targetStartTime = r.startTime;
                    if (bestMatch.times && bestMatch.times.length > 0) {
                        const timeCounts = new Map<string, number>();
                        let maxTimeCount = 0;
                        let maxTimeStr = targetStartTime;
                        
                        bestMatch.times.forEach(t => {
                            const tc = (timeCounts.get(t) || 0) + 1;
                            timeCounts.set(t, tc);
                            if (tc > maxTimeCount) {
                                maxTimeCount = tc;
                                maxTimeStr = t;
                            }
                        });
                        targetStartTime = maxTimeStr;
                    }
                    
                    // 다음 추천 날짜 산정
                    let targetDateStr = '';
                    let targetWeekday = 0;

                    if ((bestMatch.type === 'weekly' || bestMatch.type === 'dest-weekly') && bestMatch.targetWeekday !== undefined) {
                        targetWeekday = bestMatch.targetWeekday;
                        targetDateStr = getNextDateForWeekday(targetWeekday);
                    } else {
                        // 일일(Daily, Dest-Daily) 패턴인 경우 무조건 다가오는 다음번 평일 추천
                        const tomorrow = new Date();
                        tomorrow.setDate(tomorrow.getDate() + 1);
                        if (tomorrow.getDay() === 6) tomorrow.setDate(tomorrow.getDate() + 2); // 토요일 -> 월요일
                        else if (tomorrow.getDay() === 0) tomorrow.setDate(tomorrow.getDate() + 1); // 일요일 -> 월요일
                        
                        targetWeekday = tomorrow.getDay();
                        const y = tomorrow.getFullYear();
                        const m = String(tomorrow.getMonth() + 1).padStart(2, '0');
                        const dd = String(tomorrow.getDate()).padStart(2, '0');
                        targetDateStr = `${y}-${m}-${dd}`;
                    }
                    
                    let finalDateStr = targetDateStr;
                    let isValidDate = false;
                    
                    // 차량에 구애받지 않고 패턴을 찾았으므로, 탑승 빈도가 가장 높았던 차량 1순위
                    const fallbackVehicles = Array.from(vehicleCounter.entries()).sort((a,b) => b[1] - a[1]);
                    const topPrefVehicleId = fallbackVehicles.length > 0 ? fallbackVehicles[0][0] : r.vehicleId;
                    
                    let targetVehicleId = topPrefVehicleId;
                    let targetVehicleName = r.vehicleName || '차량';

                    try {
                        let attempts = 0;
                        while (!isValidDate && attempts < 4) {
                            const q = query(
                                collection(db, 'reservations'),
                                where('organizationId', '==', orgId),
                                where('date', '==', finalDateStr)
                            );
                            const snap = await getDocs(q);
                            
                            const activeResList = snap.docs
                                .map(doc => doc.data())
                                .filter(data => data.status !== 'cancelled');

                            const isTimeConflict = (start1: string, end1: string, start2: string, end2: string) => {
                                return start1 < end2 && start2 < end1;
                            };

                            const targetStart = targetStartTime;
                            const targetEnd = r.endTime && r.startTime < r.endTime ? 
                                (targetStartTime < r.endTime ? r.endTime : targetStartTime) : targetStartTime;

                            // 1. 내 일정이 동일한 날짜/시간대에 겹치는지 우선 검사
                            const isMyScheduleConflict = activeResList.some(res => 
                                res.reservedByUid === uid && 
                                isTimeConflict(targetStart, targetEnd, res.startTime, res.endTime || res.startTime)
                            );

                            if (!isMyScheduleConflict) {
                                // 2. 내 일정이 가능할 때, 1순위 추천 차량이 겹치는지 검사
                                const isVehicleUnavailable = activeResList.some(res => 
                                    res.vehicleId === targetVehicleId && 
                                    isTimeConflict(targetStart, targetEnd, res.startTime, res.endTime || res.startTime)
                                );

                                if (!isVehicleUnavailable) {
                                    isValidDate = true;
                                    break;
                                } else {
                                    // 3. 대체 차량 탐색
                                    const unavailableVehicleIds = new Set(
                                        activeResList
                                            .filter(res => isTimeConflict(targetStart, targetEnd, res.startTime, res.endTime || res.startTime))
                                            .map(res => res.vehicleId)
                                    );
                                    
                                    const availableVehicles = vehiclesDataCache.filter(v => 
                                        !unavailableVehicleIds.has(v.id) && !v.retired?.isRetired
                                    );
                                    
                                    if (availableVehicles.length > 0) {
                                        availableVehicles.sort((a, b) => {
                                            const countA = vehicleCounter.get(a.id) || 0;
                                            const countB = vehicleCounter.get(b.id) || 0;
                                            return countB - countA; 
                                        });
                                        
                                        const altVehicle = availableVehicles[0];
                                        targetVehicleId = altVehicle.id;
                                        targetVehicleName = altVehicle.displayName || altVehicle.name;
                                        
                                        isValidDate = true;
                                        break;
                                    } 
                                }
                            }
                            
                            // 충돌 시 또는 대체 차량 없을 시 1주(7일) 뒤로 연기
                            const dObj = new Date(finalDateStr + 'T00:00:00');
                            dObj.setDate(dObj.getDate() + 7);
                            const y = dObj.getFullYear();
                            const m = String(dObj.getMonth() + 1).padStart(2, '0');
                            const d = String(dObj.getDate()).padStart(2, '0');
                            finalDateStr = `${y}-${m}-${d}`;
                            
                            attempts++;
                        }
                    } catch (e) {
                         console.error('추천 날짜 충돌 검사 실패:', e);
                    }
                    
                    if (isValidDate) {
                        // 결과 배열에 넣되, 중복 날짜+시간 등이 들어가면 사용자는 헷갈리므로
                        // 날짜와 시간이 완전히 동일한 경우 필터링 (가장 점수 높은 하나만 반영)
                        const isDuplicateTime = finalRecommendations.some(
                            rec => rec.date === finalDateStr && rec.startTime === targetStartTime
                        );
                        if (!isDuplicateTime) {
                            finalRecommendations.push({
                                vehicleId: targetVehicleId,
                                vehicleName: targetVehicleName,
                                date: finalDateStr,
                                startTime: targetStartTime,
                                endTime: r.endTime && r.startTime < r.endTime ? 
                                    (targetStartTime < r.endTime ? r.endTime : targetStartTime) : targetStartTime,
                                destination: r.destination || '',
                                dayOfWeekRaw: targetWeekday,
                            });
                        }
                    }
                } // for loop end

                if (mounted) {
                    setRecommended(finalRecommendations);
                }
            } catch (err) {
                console.error('예약 패턴 분석 중 오류가 발생했습니다:', err);
                if (mounted) {
                    setRecommended([]);
                    setRecentDestinations([]);
                }
            } finally {
                if (mounted) setLoading(false);
            }
        };

        analyze();

        return () => { mounted = false; };
    }, [userData?.organizationId, user?.uid]);

    return { recommended, recentDestinations, loading };
}
