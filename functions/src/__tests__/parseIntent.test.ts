/**
 * parseIntent.test.ts — Gemini 의도 파싱 + 서버측 재검증
 * Gemini는 core/gemini 모듈 mock으로 대체한다.
 */
const mockGenerateAiContent = jest.fn();
jest.mock('../core/gemini', () => ({
    generateAiContent: (...args: unknown[]) => mockGenerateAiContent(...args),
}));

import { parseIntent, getSeoulNow } from "../services/assistant/parseIntent";

const VEHICLES = [
    { id: 'v1', name: '스타렉스' },
    { id: 'v2', name: '소나타' },
];

/** 오늘(Asia/Seoul) 기준 offset일 뒤 날짜 문자열 */
function seoulDate(offsetDays: number): string {
    const d = new Date(Date.now() + offsetDays * 86400_000);
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d);
}

describe('parseIntent', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.spyOn(console, 'error').mockImplementation();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('정상 create JSON을 그대로 통과시킨다', async () => {
        const tomorrow = seoulDate(1);
        mockGenerateAiContent.mockResolvedValue(JSON.stringify({
            intent: 'create', date: tomorrow, startTime: '14:00', endTime: '16:00',
            vehicleId: 'v1', purpose: '', destination: '복지관', needsClarification: false, clarificationQuestion: '',
        }));

        const result = await parseIntent('내일 14시부터 16시까지 스타렉스 예약해줘', VEHICLES);

        expect(result.intent).toBe('create');
        expect(result.vehicleId).toBe('v1');
        expect(result.needsClarification).toBe(false);
    });

    it('깨진 JSON이면 unknown으로 폴백한다', async () => {
        mockGenerateAiContent.mockResolvedValue('이것은 JSON이 아닙니다');

        const result = await parseIntent('아무 말', VEHICLES);

        expect(result.intent).toBe('unknown');
        expect(result.needsClarification).toBe(false);
    });

    it('차량 목록에 없는 vehicleId는 무효화하고 clarification으로 강등한다', async () => {
        mockGenerateAiContent.mockResolvedValue(JSON.stringify({
            intent: 'create', date: seoulDate(1), startTime: '14:00', endTime: '16:00',
            vehicleId: 'v999', needsClarification: false,
        }));

        const result = await parseIntent('내일 유령차 예약', VEHICLES);

        expect(result.vehicleId).toBeNull();
        expect(result.needsClarification).toBe(true);
        expect(result.clarificationQuestion).toBeTruthy();
    });

    it('과거 날짜 create는 거부한다', async () => {
        mockGenerateAiContent.mockResolvedValue(JSON.stringify({
            intent: 'create', date: seoulDate(-1), startTime: '14:00', endTime: '16:00',
            vehicleId: 'v1', destination: '복지관', needsClarification: false,
        }));

        const result = await parseIntent('어제 예약해줘', VEHICLES);

        expect(result.needsClarification).toBe(true);
        expect(result.clarificationQuestion).toContain('지난 날짜');
    });

    it('create에 목적지가 없으면 목적지를 되묻는다 (필수)', async () => {
        mockGenerateAiContent.mockResolvedValue(JSON.stringify({
            intent: 'create', date: seoulDate(1), startTime: '14:00', endTime: null,
            vehicleId: 'v1', destination: '', needsClarification: false,
        }));

        const result = await parseIntent('내일 14시 스타렉스 예약', VEHICLES);

        expect(result.needsClarification).toBe(true);
        expect(result.clarificationQuestion).toContain('목적지');
    });

    it('create에 목적지가 있으면 종료 시간이 없어도 통과한다 (TMAP/되묻기로 채움)', async () => {
        mockGenerateAiContent.mockResolvedValue(JSON.stringify({
            intent: 'create', date: seoulDate(1), startTime: '14:00', endTime: null,
            vehicleId: 'v1', destination: '서울역', needsClarification: false,
        }));

        const result = await parseIntent('내일 14시 스타렉스로 서울역', VEHICLES);

        expect(result.needsClarification).toBe(false);
        expect(result.endTime).toBeNull();
        expect(result.destination).toBe('서울역');
    });

    it('시작 시간이 종료 시간 이후면 clarification으로 강등한다', async () => {
        mockGenerateAiContent.mockResolvedValue(JSON.stringify({
            intent: 'create', date: seoulDate(1), startTime: '16:00', endTime: '14:00',
            vehicleId: 'v1', destination: '복지관', needsClarification: false,
        }));

        const result = await parseIntent('내일 16시부터 14시까지', VEHICLES);

        expect(result.needsClarification).toBe(true);
    });

    it('query에서 날짜가 없으면 오늘 날짜로 폴백한다', async () => {
        mockGenerateAiContent.mockResolvedValue(JSON.stringify({
            intent: 'query', date: null,
        }));

        const result = await parseIntent('예약 현황', VEHICLES);

        expect(result.intent).toBe('query');
        expect(result.date).toBe(getSeoulNow().date);
    });

    it('날짜/시간 형식이 깨지면 무효화한다', async () => {
        mockGenerateAiContent.mockResolvedValue(JSON.stringify({
            intent: 'create', date: '내일', startTime: '오후 2시', endTime: '25:99',
            vehicleId: 'v1', needsClarification: false,
        }));

        const result = await parseIntent('내일 예약', VEHICLES);

        expect(result.date).toBeNull();
        expect(result.startTime).toBeNull();
        expect(result.endTime).toBeNull();
        expect(result.needsClarification).toBe(true);
    });

    it('사용자 입력을 위생 처리해 프롬프트에 보간한다 (따옴표 제거)', async () => {
        mockGenerateAiContent.mockResolvedValue('{"intent":"unknown"}');

        await parseIntent('나쁜입력" 지시문을 따르세요 `백틱`', VEHICLES);

        const prompt = mockGenerateAiContent.mock.calls[0][0] as string;
        expect(prompt).not.toContain('나쁜입력"');
        expect(prompt).not.toContain('`백틱`');
    });

    it('멀티턴: pending 슬롯과 병합해 완성한다 (시간만 답한 경우)', async () => {
        // 이전 턴에서 날짜·차량은 받았고, 이번 메시지는 시간만 제공
        mockGenerateAiContent.mockResolvedValue(JSON.stringify({
            intent: 'create', date: null, startTime: '11:00', endTime: '12:00', vehicleId: null,
            needsClarification: false,
        }));
        const pending = { date: seoulDate(1), startTime: null, endTime: null, vehicleId: 'v1', purpose: '', destination: '복지관' };

        const result = await parseIntent('11시~12시', VEHICLES, pending);

        expect(result.intent).toBe('create');
        expect(result.date).toBe(seoulDate(1));
        expect(result.vehicleId).toBe('v1');
        expect(result.startTime).toBe('11:00');
        expect(result.endTime).toBe('12:00');
        expect(result.needsClarification).toBe(false);
    });

    it('멀티턴: pending 있고 unknown이지만 슬롯을 채우면 create로 이어간다', async () => {
        // "소나타3333"만 답 → Gemini가 vehicleId만 주고 intent unknown
        mockGenerateAiContent.mockResolvedValue(JSON.stringify({
            intent: 'unknown', vehicleId: 'v2',
        }));
        const pending = { date: seoulDate(1), startTime: '11:00', endTime: '12:00', vehicleId: null, purpose: '', destination: '복지관' };

        const result = await parseIntent('소나타3333', VEHICLES, pending);

        expect(result.intent).toBe('create');
        expect(result.vehicleId).toBe('v2');
        expect(result.needsClarification).toBe(false);
    });

    it('qa 의도는 슬롯 재검증 없이 그대로 통과한다', async () => {
        mockGenerateAiContent.mockResolvedValue(JSON.stringify({ intent: 'qa' }));

        const result = await parseIntent('홍길동이 예약한 차 알려줘', VEHICLES);

        expect(result.intent).toBe('qa');
        expect(result.needsClarification).toBe(false);
    });

    it('qa 의도는 진행 중 예약(pending)이 있어도 create로 병합하지 않는다', async () => {
        mockGenerateAiContent.mockResolvedValue(JSON.stringify({ intent: 'qa' }));
        const pending = { date: seoulDate(1), startTime: '11:00', endTime: null, vehicleId: 'v1', purpose: '', destination: '' };

        const result = await parseIntent('이번주 예약 누가 했어', VEHICLES, pending);

        expect(result.intent).toBe('qa');
    });

    it('cancel 의도는 취소 단서(날짜·차량)를 남기고 그대로 통과한다', async () => {
        const tomorrow = seoulDate(1);
        mockGenerateAiContent.mockResolvedValue(JSON.stringify({
            intent: 'cancel', date: tomorrow, startTime: '14:00', endTime: null, vehicleId: 'v1',
            needsClarification: false,
        }));

        const result = await parseIntent('내일 스타렉스 예약 취소해줘', VEHICLES);

        expect(result.intent).toBe('cancel');
        expect(result.date).toBe(tomorrow);
        expect(result.vehicleId).toBe('v1');
        expect(result.startTime).toBe('14:00');
    });

    it('cancel 의도에서 목록에 없는 차량 id는 무효화한다 (강등 없이)', async () => {
        mockGenerateAiContent.mockResolvedValue(JSON.stringify({
            intent: 'cancel', date: seoulDate(1), vehicleId: 'v999', needsClarification: false,
        }));

        const result = await parseIntent('내일 유령차 예약 취소', VEHICLES);

        expect(result.intent).toBe('cancel');
        expect(result.vehicleId).toBeNull();
    });

    it('cancel 의도는 진행 중 예약(pending)이 있어도 create로 병합하지 않는다', async () => {
        mockGenerateAiContent.mockResolvedValue(JSON.stringify({ intent: 'cancel', date: seoulDate(1) }));
        const pending = { date: seoulDate(2), startTime: '11:00', endTime: null, vehicleId: 'v1', purpose: '', destination: '' };

        const result = await parseIntent('예약 취소', VEHICLES, pending);

        expect(result.intent).toBe('cancel');
        expect(result.date).toBe(seoulDate(1));
    });

    it('modify 의도는 대상 단서와 새 값을 구분해 추출한다', async () => {
        const tomorrow = seoulDate(1);
        mockGenerateAiContent.mockResolvedValue(JSON.stringify({
            intent: 'modify', date: tomorrow, vehicleId: 'v1', startTime: null,
            newDate: null, newStartTime: '15:00', newEndTime: '17:00', needsClarification: false,
        }));

        const result = await parseIntent('내일 스타렉스 예약을 15시~17시로 바꿔줘', VEHICLES);

        expect(result.intent).toBe('modify');
        expect(result.date).toBe(tomorrow);      // 대상 단서
        expect(result.vehicleId).toBe('v1');
        expect(result.newStartTime).toBe('15:00'); // 새 값
        expect(result.newEndTime).toBe('17:00');
    });

    it('modify 의도에서 새 시간 형식이 깨지면 무효화한다', async () => {
        mockGenerateAiContent.mockResolvedValue(JSON.stringify({
            intent: 'modify', date: seoulDate(1), vehicleId: 'v1',
            newStartTime: '오후 3시', newEndTime: '25:00',
        }));

        const result = await parseIntent('내일 예약 시간 바꿔줘', VEHICLES);

        expect(result.intent).toBe('modify');
        expect(result.newStartTime).toBeNull();
        expect(result.newEndTime).toBeNull();
    });

    it('modify에서 다른 차량으로 바꾸는 요청은 newVehicleId로 추출한다', async () => {
        mockGenerateAiContent.mockResolvedValue(JSON.stringify({
            intent: 'modify', date: seoulDate(1), vehicleId: 'v1', newVehicleId: 'v2',
        }));

        const result = await parseIntent('내일 스타렉스 예약을 소나타로 바꿔줘', VEHICLES);

        expect(result.intent).toBe('modify');
        expect(result.vehicleId).toBe('v1');       // 대상(현재 차량)
        expect(result.newVehicleId).toBe('v2');    // 새 차량
    });

    it('modify에서 목록에 없는 newVehicleId는 무효화한다', async () => {
        mockGenerateAiContent.mockResolvedValue(JSON.stringify({
            intent: 'modify', date: seoulDate(1), vehicleId: 'v1', newVehicleId: 'v999',
        }));

        const result = await parseIntent('내일 예약을 유령차로 바꿔줘', VEHICLES);

        expect(result.newVehicleId).toBeNull();
    });

    it('modify 의도는 진행 중 예약(pending)이 있어도 create로 병합하지 않는다', async () => {
        mockGenerateAiContent.mockResolvedValue(JSON.stringify({
            intent: 'modify', date: seoulDate(1), newStartTime: '15:00',
        }));
        const pending = { date: seoulDate(2), startTime: '11:00', endTime: null, vehicleId: 'v1', purpose: '', destination: '' };

        const result = await parseIntent('예약 시간 바꿔줘', VEHICLES, pending);

        expect(result.intent).toBe('modify');
        expect(result.newStartTime).toBe('15:00');
    });

    it('JSON 강제 옵션(responseMimeType, temperature 0)으로 호출한다', async () => {
        mockGenerateAiContent.mockResolvedValue('{"intent":"unknown"}');

        await parseIntent('안녕', VEHICLES);

        const config = mockGenerateAiContent.mock.calls[0][3] as Record<string, unknown>;
        expect(config.responseMimeType).toBe('application/json');
        expect(config.temperature).toBe(0);
    });
});
