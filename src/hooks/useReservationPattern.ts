/**
 * useReservationPattern — 사용자의 과거 예약 데이터를 분석하여 다음 패턴을 추천하는 커스텀 훅
 *
 * 리팩토링: 순수 계산 로직 → utils/reservationPatternCalc
 */
import { useState, useEffect } from 'react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from './useAuth';
import { getMyRecentReservations } from '../lib/firestore/reservations';
import { getVehicles } from '../lib/firestore/vehicles';
import {
    timeToMinutes, minutesToTime, getNextDateForWeekday, getNextWeekday,
    advanceDateByWeek, isTimeConflict,
    extractTopDestinations, buildVehicleFrequency,
    aggregatePatterns, selectTopPatterns,
    getMostFrequentTime, calcAverageDuration, getMostFrequentVehicle,
    type ReservationInput,
} from './utils/reservationPatternCalc';

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

                // ── 순수 계산 (utils 위임) ─────────────────
                const inputs: ReservationInput[] = recent.map(r => ({
                    date: r.date,
                    startTime: r.startTime,
                    endTime: r.endTime,
                    vehicleId: r.vehicleId,
                    vehicleName: r.vehicleName,
                    destination: r.destination,
                }));

                const topDests = extractTopDestinations(inputs);
                if (mounted) setRecentDestinations(topDests);

                const vehicleCounter = buildVehicleFrequency(inputs);
                const patternMap = aggregatePatterns(inputs);
                const topPatterns = selectTopPatterns(patternMap, recent.length);

                // ── IO: 충돌 검사 + 추천 결과 생성 ─────────
                const finalRecommendations: RecommendedPattern[] = [];
                const vehiclesDataCache = await getVehicles(orgId);

                for (const bestMatch of topPatterns) {
                    const r = bestMatch.reservation;
                    
                    // 출발/반납 시간 최적화 (순수 계산)
                    const targetStartTime = getMostFrequentTime(bestMatch.times, r.startTime || '09:00');
                    const avgDuration = calcAverageDuration(bestMatch.durations);
                    const calculatedEndTime = minutesToTime(timeToMinutes(targetStartTime) + avgDuration);

                    // 다음 추천 날짜 산정 (순수 계산)
                    let targetDateStr: string;
                    let targetWeekday: number;

                    if ((bestMatch.type === 'weekly' || bestMatch.type === 'dest-weekly') && bestMatch.targetWeekday !== undefined) {
                        targetWeekday = bestMatch.targetWeekday;
                        targetDateStr = getNextDateForWeekday(targetWeekday);
                    } else {
                        const next = getNextWeekday();
                        targetWeekday = next.weekday;
                        targetDateStr = next.dateStr;
                    }
                    
                    let finalDateStr = targetDateStr;
                    let isValidDate = false;
                    
                    // 1순위 선호 차량 산출 (순수 계산)
                    const patternFavVehicleId = getMostFrequentVehicle(bestMatch.vehicles);
                    const fallbackVehicles = Array.from(vehicleCounter.entries()).sort((a, b) => b[1] - a[1]);
                    const topGlobalVehicleId = fallbackVehicles.length > 0 ? fallbackVehicles[0][0] : r.vehicleId;
                    
                    let targetVehicleId = patternFavVehicleId || topGlobalVehicleId;
                    const originVehicleData = vehiclesDataCache.find(v => v.id === targetVehicleId);
                    let targetVehicleName = originVehicleData ? (originVehicleData.displayName || originVehicleData.name) : (r.vehicleName || '차량');

                    // IO: Firestore 충돌 검사 + 대체 차량 탐색
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

                            const targetStart = targetStartTime;
                            const targetEnd = calculatedEndTime;

                            // 1. 내 일정 충돌 검사
                            const isMyScheduleConflict = activeResList.some(res => 
                                res.reservedByUid === uid && 
                                isTimeConflict(targetStart, targetEnd, res.startTime || '', res.endTime || res.startTime || '')
                            );

                            if (!isMyScheduleConflict) {
                                // 2. 추천 차량 충돌 검사
                                const isVehicleUnavailable = activeResList.some(res => 
                                    res.vehicleId === targetVehicleId && 
                                    isTimeConflict(targetStart, targetEnd, res.startTime || '', res.endTime || res.startTime || '')
                                );

                                if (!isVehicleUnavailable) {
                                    isValidDate = true;
                                    break;
                                } else {
                                    // 3. 대체 차량 탐색
                                    const unavailableVehicleIds = new Set(
                                        activeResList
                                            .filter(res => isTimeConflict(targetStart, targetEnd, res.startTime || '', res.endTime || res.startTime || ''))
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
                            
                            // 충돌 시 1주(7일) 뒤로 연기
                            finalDateStr = advanceDateByWeek(finalDateStr);
                            attempts++;
                        }
                    } catch (e) {
                         console.error('추천 날짜 충돌 검사 실패:', e);
                    }
                    
                    if (isValidDate) {
                        const isDuplicateTime = finalRecommendations.some(
                            rec => rec.date === finalDateStr && rec.startTime === targetStartTime
                        );
                        if (!isDuplicateTime) {
                            finalRecommendations.push({
                                vehicleId: targetVehicleId || '',
                                vehicleName: targetVehicleName,
                                date: finalDateStr,
                                startTime: targetStartTime,
                                endTime: calculatedEndTime,
                                destination: (r.destination || '').trim(),
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
