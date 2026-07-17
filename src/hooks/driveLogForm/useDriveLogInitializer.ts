/**
 * driveLogForm/useDriveLogInitializer.ts
 * 운행일지 폼의 초기화 useEffect 모음
 * - 차량/즐겨찾기/조직원 로드
 * - URL 쿼리 파라미터로 예약 데이터 로드
 * - 차량 변경 시 startKm 자동 갱신
 * - 전기차 도착 배터리 조회
 * - 하이패스 카드 조회
 */
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getVehicles, getFavorites, getOrganizationMembers, getLastVehicleEndKm, getLastVehicleEndBattery, getReservationById, getHipassCards, getLastVehicleDriveLog, getAdjacentDriveLogs } from '../../lib/firestore';
import { resolveStartKm } from './resolveStartKm';
import { captureError } from '../../lib/sentry';
import type { User } from 'firebase/auth';
import type { Vehicle } from '../../types/vehicle';
import type { Favorite } from '../../types/favorite';
import type { User as UserDoc } from '../../types/user';
import type { HipassCard } from '../../types/hipass';
import type { DriveLogForm, LocationState } from './types';
import type { DriveLog } from '../../types/driveLog';

const clearDrivingNotification = async (resId?: string) => {
    if (!resId || !('Notification' in window)) return;
    try {
        const reg = await navigator.serviceWorker?.ready;
        if (!reg) return;
        const notifications = await reg.getNotifications({ tag: `driving-${resId}` });
        notifications.forEach(n => n.close());
    } catch { /* 무시 */ }
};

export interface InitializerDeps {
    orgId: string | null | undefined;
    user: User | null;
    isEditMode: boolean;
    editLog: (DriveLog & { passengerNames?: string[] }) | null;
    reservationData: LocationState | null;
    queryReservationId: string | null;
    resolvedReservationData: LocationState | null;
    isElectric: boolean;
    form: Pick<DriveLogForm, 'vehicleId' | 'driveDate' | 'startTime'>;
    showToast: (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
    // Setters
    setVehicles: React.Dispatch<React.SetStateAction<Vehicle[]>>;
    setFavorites: React.Dispatch<React.SetStateAction<Favorite[]>>;
    setMembers: React.Dispatch<React.SetStateAction<UserDoc[]>>;
    setLoading: (v: boolean) => void;
    setForm: React.Dispatch<React.SetStateAction<DriveLogForm>>;
    setSelectedPassengers: React.Dispatch<React.SetStateAction<UserDoc[]>>;
    setExternalPassengerCount: (v: number) => void;
    setSelectedCoDrivers: React.Dispatch<React.SetStateAction<UserDoc[]>>;
    setExternalCoDriverNames: (v: string) => void;
    setResolvedReservationData: (v: LocationState | null) => void;
    setLastEndBattery: (v: number | null) => void;
    setHipassCard: (v: HipassCard | null) => void;
    setLastDriveLog: React.Dispatch<React.SetStateAction<DriveLog | null>>;
    setNextDriveLog: React.Dispatch<React.SetStateAction<DriveLog | null>>;
    vehicles: Vehicle[];
}

/**
 * 폼 초기화 side-effect 모음 훅
 * useDriveLogForm 내부에서만 사용하세요.
 */
export function useDriveLogInitializer(deps: InitializerDeps) {
    const navigate = useNavigate();
    const {
        orgId, user, isEditMode, editLog, reservationData,
        queryReservationId, resolvedReservationData, isElectric,
        form, showToast,
        setVehicles, setFavorites, setMembers, setLoading,
        setForm, setSelectedPassengers, setExternalPassengerCount,
        setSelectedCoDrivers, setExternalCoDriverNames,
        setResolvedReservationData, setLastEndBattery, setHipassCard,
        setLastDriveLog,
        setNextDriveLog,
        vehicles,
    } = deps;

    // ── Effect 1: 초기 데이터 로드 (차량, 즐겨찾기, 조직원) ──
    useEffect(() => {
        if (!orgId || !user) return;
        const fetch = async () => {
            try {
                const [v, favs, mems] = await Promise.all([
                    getVehicles(orgId),
                    getFavorites(user.uid),
                    getOrganizationMembers(orgId),
                ]);
                setVehicles(v as Vehicle[]);
                setFavorites(favs as Favorite[]);
                // 본인 제외 + 비활성(disabled) 사용자 제외 — 신규 선택 후보에 노출하지 않는다
                const otherMembers = (mems as UserDoc[]).filter(m => m.id !== user.uid && m.status !== 'disabled');
                setMembers(otherMembers);

                if (isEditMode && editLog?.passengerNames && editLog.passengerNames.length > 0) {
                    const matched = otherMembers.filter(m =>
                        editLog.passengerNames?.includes(m.name || m.email?.split('@')[0])
                    );
                    setSelectedPassengers(matched);
                    // 조직원 이름에 매칭되지 않은 수 = 외부 동승자 수
                    const memberNames = otherMembers.map(m => m.name || m.email?.split('@')[0]);
                    const externals = editLog.passengerNames.filter(n => !memberNames.includes(n));
                    if (externals.length > 0) setExternalPassengerCount(externals.length);
                }

                // 공동 운전자 복원(정보성) — uid 우선, 없으면 이름으로 매칭
                if (isEditMode && editLog) {
                    const coUids = editLog.coDriverUids || [];
                    const coNames = editLog.coDriverNames || [];
                    if (coUids.length > 0 || coNames.length > 0) {
                        const matchedCo = otherMembers.filter(m =>
                            coUids.includes(m.id) || coNames.includes(m.name || m.email?.split('@')[0])
                        );
                        setSelectedCoDrivers(matchedCo);
                        const matchedCoNames = matchedCo.map(m => m.name || m.email?.split('@')[0]);
                        const externalCo = coNames.filter(n => !matchedCoNames.includes(n));
                        if (externalCo.length > 0) setExternalCoDriverNames(externalCo.join(', '));
                    }
                }

                if (isEditMode && editLog?.vehicleId) {
                    const { prev, next } = await getAdjacentDriveLogs(orgId, editLog.vehicleId, editLog);
                    setLastDriveLog(prev);
                    setNextDriveLog(next);
                } else if (reservationData?.vehicleId) {
                    const rv = v.find(veh => veh.id === reservationData.vehicleId);
                    const [km, lastLog] = await Promise.all([
                        resolveStartKm(orgId, reservationData.vehicleId!, { vehicle: rv || null }),
                        getLastVehicleDriveLog(orgId, reservationData.vehicleId!),
                    ]);
                    setLastDriveLog(lastLog);
                    setForm(prev => ({
                        ...prev,
                        vehicleId: reservationData.vehicleId!,
                        vehicleName: reservationData.vehicleName || rv?.displayName || '',
                        purpose: reservationData.purpose || '',
                        destination: reservationData.destination || '',
                        startKm: km,
                    }));
                } else if (v.length === 1) {
                    const [km, lastLog] = await Promise.all([
                        resolveStartKm(orgId, v[0].id, { vehicle: v[0] }),
                        getLastVehicleDriveLog(orgId, v[0].id),
                    ]);
                    setLastDriveLog(lastLog);
                    setForm(prev => ({ ...prev, vehicleId: v[0].id, vehicleName: v[0].displayName || v[0].name, startKm: km }));
                }
            } catch (err) {
                console.error('데이터 로드 실패:', err);
                captureError(err, { context: 'useDriveLogForm.fetch', orgId });
            } finally {
                setLoading(false);
            }
        };
        fetch();
    }, [orgId, reservationData?.vehicleId, reservationData?.vehicleName, reservationData?.purpose, reservationData?.destination, user, isEditMode, editLog, editLog?.id, editLog?.passengerNames, editLog?.vehicleId, setVehicles, setFavorites, setMembers, setSelectedPassengers, setExternalPassengerCount, setSelectedCoDrivers, setExternalCoDriverNames, setForm, setLoading, setLastDriveLog, setNextDriveLog]);

    // ── Effect 2: URL 쿼리 파라미터에서 reservationId로 예약 데이터 로드 (알림 클릭 시) ──
    useEffect(() => {
        if (!queryReservationId || resolvedReservationData || !orgId) return;
        const loadReservation = async () => {
            try {
                const res = await getReservationById(queryReservationId);
                if (res) {
                    if (res.status === 'completed') {
                        showToast('이미 운행일지 작성이 완료된 건입니다.', 'info');
                        clearDrivingNotification(queryReservationId);
                        navigate('/employee/today', { replace: true });
                        return;
                    }

                    const data: LocationState = {
                        reservationId: res.id,
                        vehicleId: res.vehicleId,
                        vehicleName: res.vehicleName || res.vehicleDisplayName,
                        purpose: res.purpose || '',
                        destination: res.destination || '',
                        actualStartTime: res.actualStartTime || '',
                        currentKm: res.currentKm || 0,
                    };
                    setResolvedReservationData(data);

                    // 폼에 예약 정보 반영
                    setForm(prev => ({
                        ...prev,
                        vehicleId: data.vehicleId || '',
                        vehicleName: data.vehicleName || '',
                        purpose: data.purpose || '',
                        destination: data.destination || '',
                        startTime: data.actualStartTime || prev.startTime,
                    }));

                    // startKm 조회 (현재차량정보가 우선)
                    const [lastEndKm, lastLog] = await Promise.all([
                        getLastVehicleEndKm(orgId, data.vehicleId!),
                        getLastVehicleDriveLog(orgId, data.vehicleId!),
                    ]);
                    setLastDriveLog(lastLog);
                    const km = (data.currentKm ?? lastEndKm ?? '').toString();
                    setForm(prev => ({ ...prev, startKm: km }));
                }
            } catch (err) {
                console.error('예약 데이터 로드 실패:', err);
                captureError(err, { context: 'useDriveLogForm.loadReservation', queryReservationId });
            }
        };
        loadReservation();
    }, [queryReservationId, orgId, resolvedReservationData, showToast, navigate, form.startTime, setResolvedReservationData, setForm, setLastDriveLog]);

    // ── Effect 3: 차량 변경 시 startKm 자동 갱신 ──
    useEffect(() => {
        // 수정 모드에서는 기존 기록의 startKm을 유지 (최신 endKm으로 덮어쓰지 않음)
        if (isEditMode) return;
        if (!orgId || !form.vehicleId || !form.driveDate) {
            setLastDriveLog(null);
            return;
        }
        const v = vehicles.find(veh => veh.id === form.vehicleId);
        
        Promise.all([
            resolveStartKm(orgId, form.vehicleId, {
                driveDate: form.driveDate,
                startTime: form.startTime,
                vehicle: v || null,
            }),
            getLastVehicleDriveLog(orgId, form.vehicleId)
        ]).then(([km, lastLog]) => {
            setForm(prev => ({ ...prev, startKm: km }));
            setLastDriveLog(lastLog);
        }).catch(console.error);
    }, [form.driveDate, form.vehicleId, form.startTime, orgId, vehicles, isEditMode, setForm, setLastDriveLog]);

    // ── Effect 4: 전기차 도착 배터리 조회 + 하이패스 카드 조회 ──
    useEffect(() => {
        if (!orgId || !form.vehicleId || !isElectric) {
            setLastEndBattery(null);
            return;
        }
        getLastVehicleEndBattery(orgId, form.vehicleId)
            .then(val => setLastEndBattery(val))
            .catch(() => setLastEndBattery(null));
    }, [orgId, form.vehicleId, isElectric, setLastEndBattery]);

    useEffect(() => {
        if (!orgId || !form.vehicleId) {
            setHipassCard(null);
            return;
        }
        const loadHipass = async () => {
            try {
                const cards = await getHipassCards(orgId);
                const card = cards.find((c: HipassCard) => c.vehicleId === form.vehicleId);
                setHipassCard(card || null);
                if (card) {
                    setForm(prev => ({ ...prev, hipassBalanceAfter: '' }));
                }
            } catch {
                setHipassCard(null);
            }
        };
        loadHipass();
    }, [orgId, form.vehicleId, setHipassCard, setForm]);
}
