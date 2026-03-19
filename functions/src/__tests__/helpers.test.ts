import { log, wrapHttps, wrapHandler } from '../helpers';

describe('helpers — 공통 유틸리티', () => {
    describe('log()', () => {
        beforeEach(() => {
            jest.spyOn(console, 'log').mockImplementation();
            jest.spyOn(console, 'warn').mockImplementation();
            jest.spyOn(console, 'error').mockImplementation();
        });

        afterEach(() => {
            jest.restoreAllMocks();
        });

        it('INFO → console.log 호출', () => {
            log('INFO', 'testFn', 'info message');
            expect(console.log).toHaveBeenCalledTimes(1);
            const parsed = JSON.parse((console.log as jest.Mock).mock.calls[0][0]);
            expect(parsed.severity).toBe('INFO');
            expect(parsed.function).toBe('testFn');
            expect(parsed.message).toBe('info message');
            expect(parsed.timestamp).toBeDefined();
        });

        it('WARNING → console.warn 호출', () => {
            log('WARNING', 'testFn', 'warn message');
            expect(console.warn).toHaveBeenCalledTimes(1);
            const parsed = JSON.parse((console.warn as jest.Mock).mock.calls[0][0]);
            expect(parsed.severity).toBe('WARNING');
        });

        it('ERROR → console.error 호출', () => {
            log('ERROR', 'testFn', 'error message');
            expect(console.error).toHaveBeenCalledTimes(1);
            const parsed = JSON.parse((console.error as jest.Mock).mock.calls[0][0]);
            expect(parsed.severity).toBe('ERROR');
        });

        it('extra 메타데이터가 포함된다', () => {
            log('INFO', 'testFn', 'msg', { userId: 'u1', orgId: 'org1' });
            const parsed = JSON.parse((console.log as jest.Mock).mock.calls[0][0]);
            expect(parsed.userId).toBe('u1');
            expect(parsed.orgId).toBe('org1');
        });
    });

    describe('wrapHttps()', () => {
        it('핸들러를 정상 실행한다', async () => {
            const handler = jest.fn(async (_req: any, res: any) => {
                res.json({ ok: true });
            });
            const wrapped = wrapHttps('testFn', handler);
            const req = { method: 'GET', path: '/' } as any;
            const res = { json: jest.fn(), status: jest.fn().mockReturnThis(), headersSent: false } as any;

            await wrapped(req, res);

            expect(handler).toHaveBeenCalledWith(req, res);
            expect(res.json).toHaveBeenCalledWith({ ok: true });
        });

        it('에러 발생 시 500 응답과 구조화 로그를 남긴다', async () => {
            jest.spyOn(console, 'error').mockImplementation();
            const handler = jest.fn(async () => { throw new Error('test error'); });
            const wrapped = wrapHttps('testFn', handler);
            const req = { method: 'POST', path: '/test' } as any;
            const res = { json: jest.fn(), status: jest.fn().mockReturnThis(), headersSent: false } as any;

            await wrapped(req, res);

            expect(res.status).toHaveBeenCalledWith(500);
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({ error: expect.any(String) })
            );
            const logEntry = JSON.parse((console.error as jest.Mock).mock.calls[0][0]);
            expect(logEntry.severity).toBe('ERROR');
            expect(logEntry.method).toBe('POST');
            jest.restoreAllMocks();
        });

        it('이미 헤더가 전송된 경우 추가 응답을 보내지 않는다', async () => {
            jest.spyOn(console, 'error').mockImplementation();
            const handler = jest.fn(async () => { throw new Error('test'); });
            const wrapped = wrapHttps('testFn', handler);
            const req = { method: 'GET', path: '/' } as any;
            const res = { json: jest.fn(), status: jest.fn().mockReturnThis(), headersSent: true } as any;

            await wrapped(req, res);

            expect(res.status).not.toHaveBeenCalled();
            expect(res.json).not.toHaveBeenCalled();
            jest.restoreAllMocks();
        });
    });

    describe('wrapHandler()', () => {
        it('핸들러 반환값을 그대로 반환한다', async () => {
            const handler = jest.fn(async () => ({ result: 'ok' }));
            const wrapped = wrapHandler('testFn', handler);

            const result = await wrapped('arg1', 'arg2');

            expect(result).toEqual({ result: 'ok' });
            expect(handler).toHaveBeenCalledWith('arg1', 'arg2');
        });

        it('에러 발생 시 로깅 후 에러를 재전파한다', async () => {
            jest.spyOn(console, 'error').mockImplementation();
            const handler = jest.fn(async () => { throw new Error('fail'); });
            const wrapped = wrapHandler('testFn', handler);

            await expect(wrapped()).rejects.toThrow('fail');
            expect(console.error).toHaveBeenCalled();
            jest.restoreAllMocks();
        });
    });
});
