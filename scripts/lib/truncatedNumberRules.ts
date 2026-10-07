/**
 * truncatedNumberRules — '잘려 저장된 숫자' 후보 판정 규칙 (순수 함수)
 *
 * 규칙을 스크립트 본문에서 떼어 낸 이유는 `releaseNotesRules`와 같다 — **단위 테스트가
 * 같은 규칙을 보게** 하기 위해서다. Firestore가 필요한 부분은 호출부에 남는다.
 *
 * ## 무엇을 찾나
 * 저장 시 `parseInt`를 쓰던 시절(#370 이전), `<input type="number">`가 넘기는 지수 표기가
 * 잘려 저장됐다 — `parseInt('1e5')`는 **1**이다. 화면에는 100,000으로 보이고 검증
 * (`Number` 기준)도 통과하는데 저장만 1이 된다. 그렇게 남은 값은 **자릿수가 비정상적으로
 * 작은 양수**다.
 *
 * ## 확신할 수 없다는 것을 규칙에 담았다
 * 작은 값이 전부 이 버그 때문은 아니다 — 사람이 1을 잘못 칠 수도 있고, 신차의 누적 km은
 * 실제로 작다. 그래서 판정 대신 **확신도(confidence)** 를 매겨 후보로만 내놓는다.
 * 고치는 것은 사람이 한다(check-negative-values와 같은 자세).
 *
 * ## 일부러 보지 않는 필드
 * - `driveLogs.startKm`·`endKm`·`hipassBalanceAfter` — 처음부터 `Number()`로 변환했다.
 *   이 버그의 영향권이 아니다(가장 건수가 많은 필드라 먼저 확인했다).
 * - `fuelLogs.fuelAmount` — `roundFuelAmount`가 `Number` 기반이라 역시 영향이 없다.
 * - `hipassCharges.balanceBefore`·`balanceAfter` — 사람이 치는 값이 아니라 카드 잔액에서
 *   파생된다. 원인이 아니라 결과라 여기서 세면 같은 사건을 두 번 세게 된다.
 * - 음수·NaN — `check-negative-values.ts`가 본다. 나눠 둬야 두 점검이 서로를 덮지 않는다.
 */

/** 후보의 확신도 — 높을수록 이 버그일 가능성이 크다 */
export type Confidence = 'high' | 'medium' | 'low';

export interface Candidate {
    /** Firestore 필드명 */
    field: string;
    /** 사람이 읽는 항목명 */
    label: string;
    /** 저장돼 있는 값 */
    value: number;
    /** 단위 (리포트 출력용) */
    unit: string;
    confidence: Confidence;
    /** 왜 후보로 골랐는지 — 리포트에 그대로 찍는다 */
    reason: string;
}

interface FloorRule {
    field: string;
    label: string;
    unit: string;
    /** 이 값 미만이면 후보 (양수만 본다) */
    floor: number;
    confidence: Confidence;
    /** 바닥값의 근거 */
    reason: string;
}

/**
 * 컬렉션별 바닥값.
 *
 * 바닥값은 "이 값보다 작으면 실무에서 설명되지 않는다"는 선이다. 넉넉하게 잡았다 —
 * 좁게 잡아 놓치는 것보다 후보가 몇 건 더 나오는 편이 낫다(사람이 거른다).
 */
const FLOOR_RULES: Record<string, FloorRule[]> = {
    fuelLogs: [
        {
            field: 'fuelCost',
            label: '주유·충전 금액',
            unit: '원',
            floor: 1000,
            confidence: 'high',
            reason: '1회 주유·충전 금액이 1,000원 미만인 경우는 실무에 없다',
        },
        {
            field: 'meterReading',
            label: '주유미터',
            unit: 'km',
            floor: 100,
            confidence: 'high',
            reason: '누적 주행거리가 100km 미만인 차량은 사실상 없다',
        },
    ],
    hipassCharges: [
        {
            field: 'chargeAmount',
            label: '충전금액',
            unit: '원',
            floor: 1000,
            confidence: 'high',
            reason: '하이패스 1회 충전이 1,000원 미만인 경우는 실무에 없다',
        },
    ],
    maintenanceRecords: [
        {
            field: 'cost',
            label: '정비 비용',
            unit: '원',
            floor: 1000,
            confidence: 'medium',
            reason: '정비 비용이 1,000원 미만 — 다만 소모품 실비는 작을 수 있다',
        },
        {
            field: 'km',
            label: '정비 시 km',
            unit: 'km',
            floor: 100,
            confidence: 'high',
            reason: '정비 시점의 누적 주행거리가 100km 미만인 경우는 사실상 없다',
        },
        {
            field: 'nextDueKm',
            label: '다음 정비 km',
            unit: 'km',
            floor: 100,
            confidence: 'high',
            reason: '다음 정비 예정 km이 100km 미만인 경우는 사실상 없다',
        },
    ],
    hipassCards: [
        {
            field: 'balance',
            label: '카드 현재 잔액',
            unit: '원',
            floor: 100,
            confidence: 'low',
            reason: '잔액이 100원 미만 — 실제로 거의 다 쓴 카드일 수 있다',
        },
    ],
    vehicles: [
        {
            field: 'currentKm',
            label: '현재 누적 km',
            unit: 'km',
            floor: 100,
            confidence: 'low',
            reason: '누적 주행거리가 100km 미만 — 갓 출고된 차량일 수 있다',
        },
    ],
};

/** 이 스크립트가 보는 컬렉션 목록 (호출부가 순회한다) */
export const AUDITED_COLLECTIONS = Object.keys(FLOOR_RULES);

/** 컬렉션의 바닥값 규칙을 돌려준다 (리포트 머리말에서 기준을 그대로 보여 주려고 공개한다) */
export function floorRulesFor(collection: string): readonly FloorRule[] {
    return FLOOR_RULES[collection] ?? [];
}

/**
 * 주유 단가(원/L)로 확신을 올린다.
 *
 * 금액만 잘리고 주유량은 멀쩡히 남았다면 단가가 터무니없이 낮아진다 — 40L을 넣고 1원이면
 * 0.025원/L이다. 휘발유 단가는 1,500원/L 안팎, 전기 충전도 kWh당 수백 원이라
 * **100원 미만이면 금액 쪽이 잘렸다고 볼 근거**가 된다. 값이 없거나 0이면 판단하지 않는다.
 */
export function fuelUnitPrice(fuelCost: unknown, fuelAmount: unknown): number | null {
    if (typeof fuelCost !== 'number' || typeof fuelAmount !== 'number') return null;
    if (!Number.isFinite(fuelCost) || !Number.isFinite(fuelAmount)) return null;
    if (fuelAmount <= 0) return null;
    return fuelCost / fuelAmount;
}

/** 단가가 이 값 미만이면 금액이 잘린 것으로 본다 */
const IMPLAUSIBLE_UNIT_PRICE = 100;

/**
 * 문서 하나에서 '잘린 숫자' 후보를 모은다.
 *
 * @param collection Firestore 컬렉션명
 * @param data 문서 데이터
 */
export function findTruncationCandidates(collection: string, data: Record<string, unknown>): Candidate[] {
    const rules = FLOOR_RULES[collection];
    if (!rules) return [];

    const candidates: Candidate[] = [];
    for (const rule of rules) {
        const value = data[rule.field];
        // 숫자가 아니거나 0 이하는 건너뛴다 — 0은 '미입력'이고, 음수·NaN은 다른 점검의 몫이다.
        if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) continue;
        if (value >= rule.floor) continue;

        let { confidence, reason } = rule;

        // 주유 금액은 단가로 교차 확인해 확신을 올린다.
        if (collection === 'fuelLogs' && rule.field === 'fuelCost') {
            const unitPrice = fuelUnitPrice(value, data.fuelAmount);
            if (unitPrice !== null && unitPrice < IMPLAUSIBLE_UNIT_PRICE) {
                confidence = 'high';
                reason = `${reason} (주유량 ${data.fuelAmount}에 대해 단가 ${unitPrice.toFixed(2)}원 — 금액만 잘린 모양)`;
            }
        }

        candidates.push({
            field: rule.field,
            label: rule.label,
            value,
            unit: rule.unit,
            confidence,
            reason,
        });
    }
    return candidates;
}

/** 확신도 정렬용 가중치 (높은 것부터 보여 준다) */
export const CONFIDENCE_ORDER: Record<Confidence, number> = { high: 0, medium: 1, low: 2 };

/** 확신도 한글 라벨 */
export const CONFIDENCE_LABEL: Record<Confidence, string> = {
    high: '높음',
    medium: '보통',
    low: '낮음',
};
