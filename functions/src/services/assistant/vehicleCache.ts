/**
 * vehicleCache — 어시스턴트가 쓰는 기관 차량 목록의 2단 캐시
 *
 * ## 왜 필요한가
 * 어시스턴트는 **메시지 한 통마다** 기관의 차량 컬렉션을 통째로 읽는다(차량 이름으로
 * 의도를 파싱해야 하기 때문이다). 차량 10대면 슬랙 메시지 1건에 10 읽기이고, 되묻기가
 * 오가는 대화에서는 턴마다 그만큼 반복된다. 차량 목록은 몇 달에 한 번 바뀌는 값인데
 * 읽기는 대화량에 비례해 늘어난다.
 *
 * ## 2단인 이유
 * routeEstimate의 TMAP 캐시와 같은 구조다. L1(인스턴스 메모리)만 두면 인스턴스가 재활용될
 * 때마다 통째로 날아가는데, 봇 트래픽은 띄엄띄엄해 콜드 스타트가 잦다. L2(Firestore)는
 * 그 사이를 잇는다 — 차량 N대를 읽는 대신 캐시 문서 1개를 읽는다.
 *
 * ## 오래된 목록으로 예약이 새지 않는가
 * 새지 않는다. 예약을 실제로 만드는 자리(createReservationCore 트랜잭션)가 차량 문서를
 * 다시 읽어 **퇴역·정비 차단·사용 가능 직원**을 권위 있게 재검증한다. 여기 캐시가 만드는
 * 차이는 "봇의 답이 최대 5분 늦을 수 있다"까지다(예: 방금 등록한 차량이 목록에 없음).
 * 그래서 TTL을 대화 상태(10분)보다 짧게 잡는다.
 *
 * ## 무효화는 TTL뿐이다
 * 차량 등록·수정은 클라이언트가 Firestore에 직접 쓰므로 서버가 끼어들 자리가 없다.
 * 그 한 자리를 위해 vehicles 트리거를 새로 배포하면 쓰기마다 함수 호출이 붙는데,
 * 얻는 것은 최대 5분의 반영 지연 단축뿐이라 값을 못한다.
 */
import { getFirestore } from "firebase-admin/firestore";
import { log } from "../../utils/helpers";

/** 캐시 유효 시간 — 대화 상태 TTL(10분)보다 짧게 둔다 */
const VEHICLE_CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_COLLECTION = "assistantVehicleCache";
/** L1 상한 — 한 인스턴스가 여러 기관을 처리할 수 있다 */
const L1_MAX_ORGS = 50;

export interface CachedVehicle {
    id: string;
    name: string;
    isBlocked: boolean;
    siteId?: string;
}

interface L1Entry {
    vehicles: CachedVehicle[];
    expiresAt: number;
}

const l1 = new Map<string, L1Entry>();

/** 값이 어디서 왔는지 — 적중률은 구조화 로그로 집계한다(routeEstimate와 같은 방식) */
type VehicleCacheSource = "l1" | "l2" | "query";

/** 테스트 전용 — 케이스 간 L1 격리 */
export function __resetAssistantVehicleCache(): void {
    l1.clear();
}

/**
 * 캐시에서 차량 목록을 꺼낸다. 없거나 만료면 `loadFromFirestore`로 채운다.
 *
 * 캐시 계층의 실패는 삼킨다 — 캐시는 있으면 좋은 것이지 있어야 하는 것이 아니다.
 * Firestore가 느리거나 규칙에 막혀도 차량 목록 조회 자체는 진행되어야 한다.
 */
export async function getCachedVehicles(
    orgId: string,
    loadFromFirestore: () => Promise<CachedVehicle[]>,
): Promise<CachedVehicle[]> {
    const now = Date.now();

    const hit = l1.get(orgId);
    if (hit && hit.expiresAt > now) {
        logSource("l1", hit.vehicles.length);
        return hit.vehicles;
    }
    if (hit) l1.delete(orgId);

    const stored = await l2Get(orgId, now);
    if (stored) {
        setL1(orgId, stored, now);
        logSource("l2", stored.length);
        return stored;
    }

    const vehicles = await loadFromFirestore();
    setL1(orgId, vehicles, now);
    await l2Set(orgId, vehicles, now);
    logSource("query", vehicles.length);
    return vehicles;
}

function setL1(orgId: string, vehicles: CachedVehicle[], now: number): void {
    if (l1.size >= L1_MAX_ORGS && !l1.has(orgId)) {
        const oldest = l1.keys().next();
        if (!oldest.done) l1.delete(oldest.value);
    }
    l1.set(orgId, { vehicles, expiresAt: now + VEHICLE_CACHE_TTL_MS });
}

async function l2Get(orgId: string, now: number): Promise<CachedVehicle[] | undefined> {
    try {
        const snap = await getFirestore().collection(CACHE_COLLECTION).doc(orgId).get();
        if (!snap.exists) return undefined;
        const data = snap.data() as { vehicles?: CachedVehicle[]; expiresAt?: { toMillis?: () => number } | Date } | undefined;
        if (!data || !Array.isArray(data.vehicles)) return undefined;
        // TTL 정책의 삭제는 만료 후 최대 24시간까지 늦어질 수 있어 만료 판정을 여기서 다시 한다.
        const expiresAt = data.expiresAt;
        const expiresMs = expiresAt instanceof Date
            ? expiresAt.getTime()
            : (typeof expiresAt?.toMillis === "function" ? expiresAt.toMillis() : 0);
        if (expiresMs <= now) return undefined;
        return data.vehicles;
    } catch {
        return undefined;
    }
}

async function l2Set(orgId: string, vehicles: CachedVehicle[], now: number): Promise<void> {
    try {
        await getFirestore().collection(CACHE_COLLECTION).doc(orgId).set({
            vehicles,
            // Date로 쓰면 Firestore가 timestamp로 저장한다 — TTL 정책이 요구하는 타입이다.
            expiresAt: new Date(now + VEHICLE_CACHE_TTL_MS),
        });
    } catch {
        /* 캐시 기록 실패는 응답에 영향을 주지 않는다 */
    }
}

/** 차량 이름·id는 남기지 않는다 — 적중률 집계에는 출처와 건수만 있으면 된다. */
function logSource(source: VehicleCacheSource, count: number): void {
    log("INFO", "assistantVehicleCache", "차량 목록 캐시 출처", { source, count });
}
