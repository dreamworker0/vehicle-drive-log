/**
 * handleAssistantMessage.test.ts — 어시스턴트 오케스트레이터 분기
 * parseIntent/조회/예약 코어는 mock, 차량 목록 조회는 Firestore mock.
 */
class MockHttpsError extends Error {
    code: string;
    constructor(code: string, message: string) { super(message); this.code = code; }
}
jest.mock('firebase-functions/v2/https', () => ({
    HttpsError: MockHttpsError,
}));

// ── Firestore Mock: vehicles(where/get) + assistantConversations(doc get/set/delete) ──
let vehicleDocs: Array<{ id: string; data: () => Record<string, unknown> }> = [];
const mockConvoGet = jest.fn(async () => ({ exists: false }));
const mockConvoSet = jest.fn().mockResolvedValue(undefined);
const mockConvoDelete = jest.fn().mockResolvedValue(undefined);
jest.mock('firebase-admin/firestore', () => ({
    getFirestore: () => ({
        collection: jest.fn(() => ({
            where: jest.fn().mockReturnThis(),
            get: jest.fn(async () => ({ docs: vehicleDocs })),
            doc: jest.fn(() => ({ get: mockConvoGet, set: mockConvoSet, delete: mockConvoDelete })),
        })),
    }),
    FieldValue: { serverTimestamp: jest.fn(() => 'mock-timestamp') },
}));

const mockParseIntent = jest.fn();
jest.mock('../services/assistant/parseIntent', () => ({
    parseIntent: (...args: unknown[]) => mockParseIntent(...args),
    // modify 분기의 과거일 검증이 실제 오늘(Asia/Seoul)을 참조하므로 실제 구현을 제공
    getSeoulNow: () => ({
        date: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date()),
        weekday: '', time: '',
    }),
}));

/** 오늘(Asia/Seoul) 기준 offset일 뒤 날짜 문자열 */
function seoulDateStr(offsetDays: number): string {
    const d = new Date(Date.now() + offsetDays * 86400_000);
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d);
}
const mockBuildSummary = jest.fn();
jest.mock('../services/assistant/queryReservations', () => ({
    buildReservationSummary: (...args: unknown[]) => mockBuildSummary(...args),
}));
const mockCreateTx = jest.fn();
jest.mock('../services/reservation/createReservationCore', () => ({
    createReservationTx: (...args: unknown[]) => mockCreateTx(...args),
}));
const mockAnswerData = jest.fn();
jest.mock('../services/assistant/answerDataQuestion', () => ({
    answerDataQuestion: (...args: unknown[]) => mockAnswerData(...args),
}));
const mockFindCandidates = jest.fn();
jest.mock('../services/assistant/cancelReservation', () => ({
    findCancelCandidates: (...args: unknown[]) => mockFindCandidates(...args),
}));
const mockCancelTx = jest.fn();
jest.mock('../services/reservation/cancelReservationCore', () => ({
    cancelReservationTx: (...args: unknown[]) => mockCancelTx(...args),
}));
const mockModifyTx = jest.fn();
jest.mock('../services/reservation/modifyReservationCore', () => ({
    modifyReservationTx: (...args: unknown[]) => mockModifyTx(...args),
}));

import { handleAssistantMessage, executeReservationProposal, executeCancelProposal, executeModifyProposal } from "../services/assistant/handleAssistantMessage";

const ACTOR = { uid: 'user1', orgId: 'org1', displayName: '홍길동' };

function vehicle(id: string, data: Record<string, unknown>) {
    return { id, data: () => data };
}

describe('handleAssistantMessage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        vehicleDocs = [
            vehicle('v1', { name: '스타렉스' }),
            vehicle('v2', { name: '소나타', retired: { isRetired: true } }),
            vehicle('v3', { name: '카니발', maintenance: { isBlocked: true } }),
        ];
    });

    it('query 의도면 예약 요약을 반환한다', async () => {
        mockParseIntent.mockResolvedValue({ intent: 'query', date: '2026-07-18' });
        mockBuildSummary.mockResolvedValue('📅 요약');

        const result = await handleAssistantMessage('오늘 예약', ACTOR);

        expect(mockBuildSummary).toHaveBeenCalledWith('org1', '2026-07-18');
        expect(result.replyText).toBe('📅 요약');
        expect(result.proposal).toBeUndefined();
    });

    it('퇴역 차량은 파싱용 차량 목록에서 제외한다', async () => {
        mockParseIntent.mockResolvedValue({ intent: 'unknown', needsClarification: false });

        await handleAssistantMessage('안녕', ACTOR);

        const vehicles = mockParseIntent.mock.calls[0][1] as Array<{ id: string }>;
        expect(vehicles.map((v) => v.id)).toEqual(['v1', 'v3']);
    });

    it('create + clarification 필요면 되묻는다', async () => {
        mockParseIntent.mockResolvedValue({
            intent: 'create', needsClarification: true, clarificationQuestion: '종료 시간을 알려주세요.',
        });

        const result = await handleAssistantMessage('내일 스타렉스', ACTOR);

        expect(result.replyText).toBe('종료 시간을 알려주세요.');
        expect(result.proposal).toBeUndefined();
    });

    it('create 완성이면 proposal을 반환한다 (즉시 생성하지 않음)', async () => {
        mockParseIntent.mockResolvedValue({
            intent: 'create', needsClarification: false,
            date: '2026-07-19', startTime: '14:00', endTime: '16:00',
            vehicleId: 'v1', purpose: '출장', destination: '복지관',
        });

        const result = await handleAssistantMessage('내일 예약', ACTOR);

        expect(result.proposal).toEqual({
            organizationId: 'org1',
            vehicleId: 'v1',
            vehicleName: '스타렉스',
            date: '2026-07-19',
            startTime: '14:00',
            endTime: '16:00',
            purpose: '출장',
            destination: '복지관',
            actorUid: 'user1',
            reservedByName: '홍길동',
        });
        expect(result.replyText).toContain('예약할까요?');
        expect(mockCreateTx).not.toHaveBeenCalled();
    });

    it('정비 중 차량이면 예약 제안을 만들지 않는다', async () => {
        mockParseIntent.mockResolvedValue({
            intent: 'create', needsClarification: false,
            date: '2026-07-19', startTime: '14:00', endTime: '16:00', vehicleId: 'v3',
        });

        const result = await handleAssistantMessage('카니발 예약', ACTOR);

        expect(result.proposal).toBeUndefined();
        expect(result.replyText).toContain('정비 중');
    });

    it('qa 의도면 answerDataQuestion 결과를 반환한다 (즉시 생성 없음)', async () => {
        mockParseIntent.mockResolvedValue({ intent: 'qa' });
        mockAnswerData.mockResolvedValue('홍길동님은 스타렉스를 예약했습니다.');

        const result = await handleAssistantMessage('홍길동이 예약한 차', ACTOR);

        expect(mockAnswerData).toHaveBeenCalledWith('홍길동이 예약한 차', 'org1', expect.any(Array));
        expect(result.replyText).toContain('홍길동');
        expect(result.proposal).toBeUndefined();
    });

    it('unknown 의도면 도움말을 보여준다', async () => {
        mockParseIntent.mockResolvedValue({ intent: 'unknown', needsClarification: false });

        const result = await handleAssistantMessage('ㅋㅋㅋ', ACTOR);

        expect(result.replyText).toContain('예약 조회');
        expect(result.replyText).toContain('예약 생성');
    });

    describe('예약 취소', () => {
        it('취소 후보가 없으면 안내만 하고 제안하지 않는다', async () => {
            mockParseIntent.mockResolvedValue({ intent: 'cancel', date: '2026-07-20', vehicleId: null, startTime: null });
            mockFindCandidates.mockResolvedValue([]);

            const result = await handleAssistantMessage('예약 취소', ACTOR);

            expect(mockFindCandidates).toHaveBeenCalledWith('org1', 'user1', { date: '2026-07-20', vehicleId: null, startTime: null });
            expect(result.replyText).toContain('찾지 못했습니다');
            expect(result.cancelProposal).toBeUndefined();
        });

        it('취소 후보가 1건이면 cancelProposal을 반환한다 (즉시 취소하지 않음)', async () => {
            mockParseIntent.mockResolvedValue({ intent: 'cancel', date: '2026-07-20', vehicleId: 'v1', startTime: null });
            mockFindCandidates.mockResolvedValue([
                { id: 'r1', vehicleId: 'v1', vehicleName: '스타렉스', date: '2026-07-20', startTime: '14:00', endTime: '16:00' },
            ]);

            const result = await handleAssistantMessage('내일 스타렉스 예약 취소', ACTOR);

            expect(result.cancelProposal).toEqual({
                reservationId: 'r1', organizationId: 'org1', actorUid: 'user1',
                vehicleName: '스타렉스', date: '2026-07-20', startTime: '14:00', endTime: '16:00',
            });
            expect(result.replyText).toContain('취소할까요?');
            expect(mockCancelTx).not.toHaveBeenCalled();
        });

        it('취소 후보가 여러 건이면 되묻고 제안하지 않는다', async () => {
            mockParseIntent.mockResolvedValue({ intent: 'cancel', date: '2026-07-20', vehicleId: null, startTime: null });
            mockFindCandidates.mockResolvedValue([
                { id: 'r1', vehicleId: 'v1', vehicleName: '스타렉스', date: '2026-07-20', startTime: '09:00', endTime: '10:00' },
                { id: 'r2', vehicleId: 'v1', vehicleName: '스타렉스', date: '2026-07-20', startTime: '14:00', endTime: '16:00' },
            ]);

            const result = await handleAssistantMessage('예약 취소', ACTOR);

            expect(result.cancelProposal).toBeUndefined();
            expect(result.replyText).toContain('여러 건');
            expect(result.replyText).toContain('09:00');
            expect(result.replyText).toContain('14:00');
        });
    });

    describe('예약 수정', () => {
        const FUTURE = seoulDateStr(2);
        const TARGET = { id: 'r1', vehicleId: 'v1', vehicleName: '스타렉스', date: FUTURE, startTime: '09:00', endTime: '11:00' };

        it('수정 후보가 없으면 안내만 하고 제안하지 않는다', async () => {
            mockParseIntent.mockResolvedValue({ intent: 'modify', date: FUTURE, vehicleId: null, startTime: null, newStartTime: '15:00', newEndTime: '17:00', newDate: null });
            mockFindCandidates.mockResolvedValue([]);

            const result = await handleAssistantMessage('예약 15시로 바꿔', ACTOR);

            expect(result.replyText).toContain('찾지 못했습니다');
            expect(result.modifyProposal).toBeUndefined();
        });

        it('새 시간 범위를 주면 modifyProposal(변경 전/후)을 반환한다', async () => {
            mockParseIntent.mockResolvedValue({ intent: 'modify', date: FUTURE, vehicleId: 'v1', startTime: null, newStartTime: '15:00', newEndTime: '17:00', newDate: null });
            mockFindCandidates.mockResolvedValue([TARGET]);

            const result = await handleAssistantMessage('내일 스타렉스 예약 15~17시로', ACTOR);

            expect(result.modifyProposal).toMatchObject({
                reservationId: 'r1', organizationId: 'org1', actorUid: 'user1', vehicleName: '스타렉스',
                date: FUTURE, startTime: '15:00', endTime: '17:00',
                beforeDate: FUTURE, beforeStartTime: '09:00', beforeEndTime: '11:00',
            });
            expect(result.replyText).toContain('변경할까요?');
            expect(mockModifyTx).not.toHaveBeenCalled();
        });

        it('새 시작만 주면 원래 소요시간을 유지한다 (09~11시 → 15시 시작 → 17시)', async () => {
            mockParseIntent.mockResolvedValue({ intent: 'modify', date: FUTURE, vehicleId: 'v1', startTime: null, newStartTime: '15:00', newEndTime: null, newDate: null });
            mockFindCandidates.mockResolvedValue([TARGET]);

            const result = await handleAssistantMessage('예약 15시로 옮겨', ACTOR);

            expect(result.modifyProposal?.startTime).toBe('15:00');
            expect(result.modifyProposal?.endTime).toBe('17:00'); // 2시간 유지
        });

        it('실제 변경이 없으면 무엇을 바꿀지 되묻는다', async () => {
            mockParseIntent.mockResolvedValue({ intent: 'modify', date: FUTURE, vehicleId: 'v1', startTime: null, newStartTime: null, newEndTime: null, newDate: null });
            mockFindCandidates.mockResolvedValue([TARGET]);

            const result = await handleAssistantMessage('예약 바꿔줘', ACTOR);

            expect(result.modifyProposal).toBeUndefined();
            expect(result.replyText).toContain('무엇을 어떻게');
        });

        it('후보가 여러 건이면 되묻고 제안하지 않는다', async () => {
            mockParseIntent.mockResolvedValue({ intent: 'modify', date: FUTURE, vehicleId: null, startTime: null, newStartTime: '15:00', newEndTime: null, newDate: null });
            mockFindCandidates.mockResolvedValue([
                TARGET,
                { id: 'r2', vehicleId: 'v1', vehicleName: '스타렉스', date: FUTURE, startTime: '14:00', endTime: '15:00' },
            ]);

            const result = await handleAssistantMessage('예약 15시로', ACTOR);

            expect(result.modifyProposal).toBeUndefined();
            expect(result.replyText).toContain('여러 건');
        });
    });

    describe('멀티턴 대화 기억', () => {
        const ACTOR_KEY = { ...ACTOR, conversationKey: 'slack_T_U' };

        it('진행 중 예약이 있으면 parseIntent에 pending 슬롯을 넘긴다', async () => {
            mockConvoGet.mockResolvedValue({
                exists: true,
                data: () => ({
                    slots: { date: '2026-07-19', startTime: null, endTime: null, vehicleId: 'v1', purpose: '', destination: '' },
                    expiresAt: { toDate: () => new Date(Date.now() + 60_000) },
                }),
            });
            mockParseIntent.mockResolvedValue({ intent: 'create', needsClarification: true, clarificationQuestion: '시간?' });

            await handleAssistantMessage('11시~12시', ACTOR_KEY);

            const pendingArg = mockParseIntent.mock.calls[0][2];
            expect(pendingArg).toMatchObject({ date: '2026-07-19', vehicleId: 'v1' });
        });

        it('만료된 진행 예약은 무시한다 (pending 미전달)', async () => {
            mockConvoGet.mockResolvedValue({
                exists: true,
                data: () => ({
                    slots: { date: '2026-07-19', vehicleId: 'v1' },
                    expiresAt: { toDate: () => new Date(Date.now() - 60_000) },
                }),
            });
            mockParseIntent.mockResolvedValue({ intent: 'unknown', needsClarification: false });

            await handleAssistantMessage('안녕', ACTOR_KEY);

            expect(mockParseIntent.mock.calls[0][2]).toBeUndefined();
        });

        it('create가 정보 부족이면 현재까지 슬롯을 저장한다', async () => {
            mockConvoGet.mockResolvedValue({ exists: false });
            mockParseIntent.mockResolvedValue({
                intent: 'create', needsClarification: true, clarificationQuestion: '종료 시간?',
                date: '2026-07-19', startTime: '11:00', endTime: null, vehicleId: 'v1', purpose: '', destination: '',
            });

            await handleAssistantMessage('내일 11시 스타렉스', ACTOR_KEY);

            expect(mockConvoSet).toHaveBeenCalledWith(expect.objectContaining({
                orgId: 'org1',
                slots: expect.objectContaining({ date: '2026-07-19', startTime: '11:00', endTime: null, vehicleId: 'v1' }),
            }));
        });

        it('제안 완성 시 진행 예약을 폐기한다', async () => {
            mockConvoGet.mockResolvedValue({ exists: false });
            mockParseIntent.mockResolvedValue({
                intent: 'create', needsClarification: false,
                date: '2026-07-19', startTime: '11:00', endTime: '12:00', vehicleId: 'v1', purpose: '', destination: '',
            });

            const result = await handleAssistantMessage('내일 11~12시 스타렉스', ACTOR_KEY);

            expect(result.proposal).toBeDefined();
            expect(mockConvoDelete).toHaveBeenCalled();
        });

        it('조회로 전환하면 진행 예약을 폐기한다', async () => {
            mockConvoGet.mockResolvedValue({ exists: false });
            mockParseIntent.mockResolvedValue({ intent: 'query', date: '2026-07-18' });
            mockBuildSummary.mockResolvedValue('📅 요약');

            await handleAssistantMessage('오늘 예약 현황', ACTOR_KEY);

            expect(mockConvoDelete).toHaveBeenCalled();
        });

        it('qa(자유 질의)로 전환하면 진행 예약을 폐기한다', async () => {
            mockConvoGet.mockResolvedValue({ exists: false });
            mockParseIntent.mockResolvedValue({ intent: 'qa' });
            mockAnswerData.mockResolvedValue('답변');

            await handleAssistantMessage('이번주 예약 누가 했어', ACTOR_KEY);

            expect(mockConvoDelete).toHaveBeenCalled();
        });
    });
});

describe('executeReservationProposal', () => {
    const PROPOSAL = {
        organizationId: 'org1', vehicleId: 'v1', vehicleName: '스타렉스',
        date: '2026-07-19', startTime: '14:00', endTime: '16:00',
        purpose: '', destination: '', actorUid: 'user1', reservedByName: '홍길동',
    };

    beforeEach(() => jest.clearAllMocks());

    it('성공 시 확정 메시지를 반환한다 (actorOrgId·source 주입)', async () => {
        mockCreateTx.mockResolvedValue({ reservationId: 'r1', status: 'reserved' });

        const text = await executeReservationProposal(PROPOSAL, 'slack');

        expect(mockCreateTx).toHaveBeenCalledWith(expect.objectContaining({
            actorOrgId: 'org1',
            actorUid: 'user1',
            source: 'slack',
        }));
        expect(text).toContain('예약이 확정되었습니다');
    });

    it('승인제 기관이면 승인 대기 안내를 반환한다', async () => {
        mockCreateTx.mockResolvedValue({ reservationId: 'r1', status: 'pending' });

        const text = await executeReservationProposal(PROPOSAL, 'slack');

        expect(text).toContain('승인 대기');
    });

    it('시간 충돌(HttpsError)이면 코어의 한국어 메시지를 그대로 전달한다', async () => {
        mockCreateTx.mockRejectedValue(new MockHttpsError('already-exists', '해당 차량은 10:00 ~ 12:00에 이미 예약되어 있습니다.'));

        const text = await executeReservationProposal(PROPOSAL, 'slack');

        expect(text).toContain('이미 예약되어 있습니다');
        expect(text).toContain('❌');
    });
});

describe('executeCancelProposal', () => {
    const CANCEL = {
        reservationId: 'r1', organizationId: 'org1', actorUid: 'user1',
        vehicleName: '스타렉스', date: '2026-07-20', startTime: '14:00', endTime: '16:00',
    };

    beforeEach(() => jest.clearAllMocks());

    it('성공 시 취소 완료 메시지를 반환한다 (actorUid·actorOrgId 주입)', async () => {
        mockCancelTx.mockResolvedValue({ vehicleName: '스타렉스', date: '2026-07-20', startTime: '14:00', endTime: '16:00' });

        const text = await executeCancelProposal(CANCEL, 'slack');

        expect(mockCancelTx).toHaveBeenCalledWith({
            reservationId: 'r1', actorUid: 'user1', actorOrgId: 'org1',
        });
        expect(text).toContain('취소했습니다');
        expect(text).toContain('🚫');
    });

    it('취소 실패(HttpsError)면 코어의 한국어 메시지를 그대로 전달한다', async () => {
        mockCancelTx.mockRejectedValue(new MockHttpsError('failed-precondition', '이미 취소된 예약입니다.'));

        const text = await executeCancelProposal(CANCEL, 'slack');

        expect(text).toContain('이미 취소된 예약입니다');
        expect(text).toContain('❌');
    });
});

describe('executeModifyProposal', () => {
    const MODIFY = {
        reservationId: 'r1', organizationId: 'org1', actorUid: 'user1', vehicleName: '스타렉스',
        date: '2026-07-21', startTime: '15:00', endTime: '17:00',
        beforeDate: '2026-07-20', beforeStartTime: '09:00', beforeEndTime: '11:00',
    };

    beforeEach(() => jest.clearAllMocks());

    it('성공 시 변경 완료 메시지를 반환한다 (최종값·actorUid·actorOrgId 주입)', async () => {
        mockModifyTx.mockResolvedValue({ vehicleName: '스타렉스', date: '2026-07-21', startTime: '15:00', endTime: '17:00' });

        const text = await executeModifyProposal(MODIFY, 'slack');

        expect(mockModifyTx).toHaveBeenCalledWith({
            reservationId: 'r1', actorUid: 'user1', actorOrgId: 'org1',
            date: '2026-07-21', startTime: '15:00', endTime: '17:00',
        });
        expect(text).toContain('변경했습니다');
        expect(text).toContain('✏️');
    });

    it('수정 실패(HttpsError·시간충돌)면 코어의 한국어 메시지를 그대로 전달한다', async () => {
        mockModifyTx.mockRejectedValue(new MockHttpsError('already-exists', '해당 차량은 15:00 ~ 17:00에 이미 예약되어 있습니다.'));

        const text = await executeModifyProposal(MODIFY, 'slack');

        expect(text).toContain('이미 예약되어 있습니다');
        expect(text).toContain('❌');
    });
});
