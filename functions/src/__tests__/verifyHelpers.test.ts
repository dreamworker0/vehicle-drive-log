/**
 * verifyHelpers.test.ts — 기관 자동 검증 공통 유틸
 *
 * 고정하는 계약:
 *  - downloadFileAsBase64: Admin SDK는 URL 토큰을 무시하고 경로만 쓰므로, **경로 조작과 다른 기관
 *    경로를 막는 것**이 이 함수의 유일한 방어선이다(2026-07-10 감사 #3).
 *  - Tmap 주소 검색·지오코딩: 도로명 주소 우선, 지번 조각 폴백, POI → 전체주소 지오코딩 폴백
 *  - 승인·반려 메일: 실패는 false로 접히고, 반려 메일 본문은 HTML 이스케이프된다
 * 로그 출력은 단언하지 않는다(로거 교체와 무관하게 유지).
 */
jest.mock('firebase-admin/firestore', () => ({
    getFirestore: jest.fn(() => ({ collection: jest.fn(), doc: jest.fn() })),
    FieldValue: { serverTimestamp: jest.fn() },
}));

const mockDownload = jest.fn();
const mockFile = jest.fn((_path: string) => ({ download: mockDownload }));
jest.mock('firebase-admin/storage', () => ({
    getStorage: () => ({ bucket: () => ({ file: mockFile }) }),
}));

const mockEmailSend = jest.fn();
jest.mock('@emailjs/nodejs', () => ({ send: (...a: unknown[]) => mockEmailSend(...a) }));

jest.mock('../core/params', () => ({
    EMAILJS_PRIVATE_KEY: { value: () => 'private-key-test' },
}));

const mockSendMail = jest.fn();
const mockCreateTransporter = jest.fn(() => ({ sendMail: mockSendMail }));
jest.mock('../core/mailer', () => ({
    createGmailTransporter: () => mockCreateTransporter(),
    systemMailFrom: () => '"차량운행일지" <noreply@test.local>',
}));

jest.mock('../core/gemini', () => ({ generateAiContent: jest.fn() }));

import {
    downloadFileAsBase64,
    searchAddressByTmap,
    geocodeByTmap,
    sendApprovalEmailServer,
    sendRejectionEmail,
    DUPLICATE_APPROVED_EMAIL,
} from '../services/driveLog/verifyHelpers';

const mockFetch = jest.fn();
const json = (body: unknown) => ({ json: () => Promise.resolve(body) });

describe('verifyHelpers', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockFetch.mockReset();
        global.fetch = mockFetch as unknown as typeof fetch;
        mockDownload.mockResolvedValue([Buffer.from('hello')]);
        jest.spyOn(console, 'log').mockImplementation();
        jest.spyOn(console, 'warn').mockImplementation();
        jest.spyOn(console, 'error').mockImplementation();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('downloadFileAsBase64', () => {
        it('Storage 경로를 그대로 내려받아 base64로 돌려준다 (이미지는 image/jpeg)', async () => {
            const result = await downloadFileAsBase64('organizations/org1/docs/biz.jpg', 'organizations/org1/');

            expect(mockFile).toHaveBeenCalledWith('organizations/org1/docs/biz.jpg');
            expect(result).toEqual({ base64: Buffer.from('hello').toString('base64'), mimeType: 'image/jpeg' });
        });

        it('확장자가 대문자 .PDF여도 application/pdf로 본다', async () => {
            const result = await downloadFileAsBase64('organizations/org1/docs/biz.PDF');

            expect(result.mimeType).toBe('application/pdf');
        });

        it('레거시 토큰 URL이면 /o/ 뒤 경로를 디코딩해 쓰고 토큰은 버린다', async () => {
            const url = 'https://firebasestorage.googleapis.com/v0/b/proj.appspot.com/o/organizations%2Forg1%2Fbiz.pdf?alt=media&token=secret';

            const result = await downloadFileAsBase64(url, 'organizations/org1/');

            expect(mockFile).toHaveBeenCalledWith('organizations/org1/biz.pdf');
            expect(result.mimeType).toBe('application/pdf');
        });

        it('쿼리 없는 URL·프래그먼트가 붙은 URL도 경로만 뽑는다', async () => {
            await downloadFileAsBase64('https://x/v0/b/b/o/organizations%2Forg1%2Fa.jpg');
            await downloadFileAsBase64('https://x/v0/b/b/o/organizations%2Forg1%2Fb.jpg#frag');

            expect(mockFile.mock.calls.map(c => c[0])).toEqual([
                'organizations/org1/a.jpg',
                'organizations/org1/b.jpg',
            ]);
        });

        it.each([
            ['상위 경로(..)', 'organizations/org1/../org2/biz.jpg'],
            ['URL 인코딩된 상위 경로', 'https://x/o/organizations%2Forg1%2F..%2Forg2%2Fbiz.jpg?alt=media'],
            ['역슬래시', 'organizations\\org2\\biz.jpg'],
            ['선행 슬래시', '/organizations/org1/biz.jpg'],
        ])('%s가 든 경로는 내려받지 않고 거부한다', async (_label, input) => {
            await expect(downloadFileAsBase64(input, 'organizations/org1/')).rejects.toThrow('유효하지 않은 파일 경로');
            expect(mockFile).not.toHaveBeenCalled();
        });

        it('다른 기관 경로는 거부한다 — URL을 조작해 남의 서류를 읽는 경로', async () => {
            const url = 'https://x/o/organizations%2Forg2%2Fbiz.jpg?alt=media&token=org1-token';

            await expect(downloadFileAsBase64(url, 'organizations/org1/')).rejects.toThrow('허용 범위를 벗어난 Storage 경로');
            expect(mockFile).not.toHaveBeenCalled();
        });

        it('prefix가 슬래시로 끝나면 이름이 이어지는 기관(org1 → org10)도 막는다', async () => {
            await expect(
                downloadFileAsBase64('organizations/org10/biz.jpg', 'organizations/org1/'),
            ).rejects.toThrow('허용 범위를 벗어난');
        });

        it('prefix를 주지 않으면 경로 조작 검사만 한다', async () => {
            await downloadFileAsBase64('applications/app1/biz.jpg');

            expect(mockFile).toHaveBeenCalledWith('applications/app1/biz.jpg');
        });

        it('Storage 다운로드 실패는 그대로 던진다', async () => {
            mockDownload.mockRejectedValue(new Error('No such object'));

            await expect(downloadFileAsBase64('organizations/org1/x.jpg')).rejects.toThrow('No such object');
        });
    });

    describe('searchAddressByTmap', () => {
        it('키워드나 API 키가 없으면 호출하지 않고 null이다', async () => {
            await expect(searchAddressByTmap('  ', 'key')).resolves.toBeNull();
            await expect(searchAddressByTmap('복지관', '')).resolves.toBeNull();
            expect(mockFetch).not.toHaveBeenCalled();
        });

        it('키워드를 인코딩해 POI 검색을 부르고 appKey 헤더를 붙인다', async () => {
            mockFetch.mockResolvedValue(json({}));

            await searchAddressByTmap('행복 복지관&1', 'tmap-key');

            const [url, init] = mockFetch.mock.calls[0];
            expect(url).toContain('https://apis.openapi.sk.com/tmap/pois?');
            expect(url).toContain(`searchKeyword=${encodeURIComponent('행복 복지관&1')}`);
            expect(url).toContain('count=1');
            expect(init).toEqual({ headers: { appKey: 'tmap-key' } });
        });

        it('도로명 주소를 우선 쓰고 좌표를 숫자로 돌려준다', async () => {
            mockFetch.mockResolvedValue(json({
                searchPoiInfo: { pois: { poi: [{
                    noorLat: '37.5665', noorLon: '126.9780',
                    newAddressList: { newAddress: [{ fullAddressRoad: '서울 중구 세종대로 110' }] },
                    upperAddrName: '서울', middleAddrName: '중구', lowerAddrName: '태평로1가',
                }] } },
            }));

            await expect(searchAddressByTmap('서울시청', 'k')).resolves.toEqual({
                address: '서울 중구 세종대로 110', lat: 37.5665, lng: 126.978,
            });
        });

        it('도로명이 없으면 지번 주소 조각을 이어 붙인다 (빈 조각 제외)', async () => {
            mockFetch.mockResolvedValue(json({
                searchPoiInfo: { pois: { poi: [{
                    noorLat: '35.1', noorLon: '129.0',
                    newAddressList: { newAddress: [{}] },
                    upperAddrName: '부산', middleAddrName: '해운대구', lowerAddrName: '우동', detailAddrName: '',
                }] } },
            }));

            await expect(searchAddressByTmap('해운대', 'k')).resolves.toEqual({
                address: '부산 해운대구 우동', lat: 35.1, lng: 129,
            });
        });

        it('POI가 없거나 주소 조각이 모두 비면 null이다', async () => {
            mockFetch.mockResolvedValueOnce(json({ searchPoiInfo: { pois: { poi: [] } } }));
            await expect(searchAddressByTmap('없는곳', 'k')).resolves.toBeNull();

            mockFetch.mockResolvedValueOnce(json({ searchPoiInfo: { pois: { poi: [{ noorLat: '1', noorLon: '2' }] } } }));
            await expect(searchAddressByTmap('주소없음', 'k')).resolves.toBeNull();
        });

        // 좌표가 숫자가 아니면 (0, 0)을 돌려준다 — 의도된 계약이다(2026-11-24 확인). 유일한 호출부
        // autoVerifyDocument가 좌표 0(`!geoLat`)이면 이어서 geocodeByTmap으로 좌표를 다시 구하고,
        // 이 함수의 네트워크 오류도 그 호출부가 try/catch로 받는다. 주소만이라도 살리는 쪽이 목적이다.
        it('좌표가 숫자가 아니면 0으로 채운다 (호출부가 geocodeByTmap으로 다시 구한다)', async () => {
            mockFetch.mockResolvedValue(json({
                searchPoiInfo: { pois: { poi: [{ noorLat: '', noorLon: 'abc', upperAddrName: '세종' }] } },
            }));

            await expect(searchAddressByTmap('세종', 'k')).resolves.toEqual({ address: '세종', lat: 0, lng: 0 });
        });

        it('네트워크 오류는 삼키지 않고 던진다 (geocodeByTmap과 달리)', async () => {
            mockFetch.mockRejectedValue(new Error('ETIMEDOUT'));

            await expect(searchAddressByTmap('서울', 'k')).rejects.toThrow('ETIMEDOUT');
        });
    });

    describe('geocodeByTmap', () => {
        it('주소나 API 키가 없으면 호출하지 않고 null이다', async () => {
            await expect(geocodeByTmap('', 'k')).resolves.toBeNull();
            await expect(geocodeByTmap('서울', '')).resolves.toBeNull();
            expect(mockFetch).not.toHaveBeenCalled();
        });

        it('POI 검색에서 좌표를 찾으면 지오코딩을 부르지 않는다', async () => {
            mockFetch.mockResolvedValue(json({ searchPoiInfo: { pois: { poi: [{ noorLat: '37.1', noorLon: '127.2' }] } } }));

            await expect(geocodeByTmap('수원시청', 'k')).resolves.toEqual({ lat: 37.1, lng: 127.2 });
            expect(mockFetch).toHaveBeenCalledTimes(1);
        });

        it('POI가 없으면 전체주소 지오코딩으로 넘어가고 신주소 좌표를 우선한다', async () => {
            mockFetch
                .mockResolvedValueOnce(json({}))
                .mockResolvedValueOnce(json({ coordinateInfo: { coordinate: [{ newLat: '36.5', lat: '36.0', newLon: '127.5', lon: '127.0' }] } }));

            await expect(geocodeByTmap('세종시 한누리대로 2130', 'k')).resolves.toEqual({ lat: 36.5, lng: 127.5 });
            const geoUrl = mockFetch.mock.calls[1][0] as string;
            expect(geoUrl).toContain('https://apis.openapi.sk.com/tmap/geo/fullAddrGeo?');
            expect(geoUrl).toContain(`fullAddr=${encodeURIComponent('세종시 한누리대로 2130')}`);
        });

        it('신주소 좌표가 비면 구주소 좌표를 쓴다', async () => {
            mockFetch
                .mockResolvedValueOnce(json({}))
                .mockResolvedValueOnce(json({ coordinateInfo: { coordinate: [{ newLat: '', lat: '36.0', newLon: '', lon: '127.0' }] } }));

            await expect(geocodeByTmap('어딘가', 'k')).resolves.toEqual({ lat: 36, lng: 127 });
        });

        it('POI 좌표가 0이면 실패로 보고 지오코딩으로 넘어간다', async () => {
            mockFetch
                .mockResolvedValueOnce(json({ searchPoiInfo: { pois: { poi: [{ noorLat: '0', noorLon: '0' }] } } }))
                .mockResolvedValueOnce(json({ coordinateInfo: { coordinate: [{ newLat: '35', newLon: '128', lat: '', lon: '' }] } }));

            await expect(geocodeByTmap('대구', 'k')).resolves.toEqual({ lat: 35, lng: 128 });
            expect(mockFetch).toHaveBeenCalledTimes(2);
        });

        it('둘 다 결과가 없으면 null이다', async () => {
            mockFetch.mockResolvedValueOnce(json({})).mockResolvedValueOnce(json({ coordinateInfo: { coordinate: [] } }));

            await expect(geocodeByTmap('없는주소', 'k')).resolves.toBeNull();
        });

        it('네트워크 오류는 삼키고 null을 돌려준다', async () => {
            mockFetch.mockRejectedValue(new Error('ECONNRESET'));

            await expect(geocodeByTmap('서울', 'k')).resolves.toBeNull();
        });
    });

    describe('sendApprovalEmailServer', () => {
        it('EmailJS 템플릿에 수신자·초대 코드·코드가 붙은 서비스 링크를 넘긴다', async () => {
            mockEmailSend.mockResolvedValue({ status: 200, text: 'OK' });

            await expect(sendApprovalEmailServer('a@org.kr', '행복복지관', 'ABC123', '홍길동')).resolves.toBe(true);

            const [serviceId, templateId, params, keys] = mockEmailSend.mock.calls[0];
            expect(serviceId).toBe('service_p4hpecv');
            expect(templateId).toBe('template_qmfktgb');
            expect(params).toEqual({
                to_email: 'a@org.kr',
                to_name: '홍길동',
                name: '홍길동',
                org_name: '행복복지관',
                invite_code: 'ABC123',
                service_url: 'https://drivelog.socialprism.co.kr?code=ABC123',
            });
            expect(keys).toEqual({ publicKey: expect.any(String), privateKey: 'private-key-test' });
        });

        it('신청자 이름이 없으면 기관명으로 부른다', async () => {
            mockEmailSend.mockResolvedValue({ status: 200, text: 'OK' });

            await sendApprovalEmailServer('a@org.kr', '행복복지관', 'ABC123');

            expect(mockEmailSend.mock.calls[0][2]).toMatchObject({ to_name: '행복복지관', name: '행복복지관' });
        });

        it('발송 실패는 던지지 않고 false다', async () => {
            mockEmailSend.mockRejectedValue({ status: 412, text: 'quota' });

            await expect(sendApprovalEmailServer('a@org.kr', '기관', 'X')).resolves.toBe(false);
        });
    });

    describe('sendRejectionEmail', () => {
        it('시스템 발신자로 기관명이 든 제목의 메일을 보낸다', async () => {
            mockSendMail.mockResolvedValue({ messageId: 'm1' });

            await expect(sendRejectionEmail('a@org.kr', '행복복지관', '서류 불일치')).resolves.toBe(true);

            const opts = mockSendMail.mock.calls[0][0];
            expect(opts.from).toBe('"차량운행일지" <noreply@test.local>');
            expect(opts.to).toBe('a@org.kr');
            expect(opts.subject).toBe('[차량운행일지] 기관 신청 결과 안내: 행복복지관');
            expect(opts.html).toContain('서류 불일치');
        });

        it('본문의 기관명·사유는 HTML 이스케이프한다 — 신청서 입력값이 그대로 메일 HTML이 된다', async () => {
            mockSendMail.mockResolvedValue({});

            await sendRejectionEmail('a@org.kr', '<b>기관</b>', '<script>alert(1)</script> & "x"');

            const html = mockSendMail.mock.calls[0][0].html as string;
            expect(html).not.toContain('<script>');
            expect(html).not.toContain('<b>기관</b>');
            expect(html).toContain('&lt;b&gt;기관&lt;/b&gt;');
            expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;x&quot;');
        });

        it('안내 없이 부르면 기본 머리글만 쓰고 안내 상자는 넣지 않는다', async () => {
            mockSendMail.mockResolvedValue({});

            await sendRejectionEmail('a@org.kr', '기관', '사유');

            const html = mockSendMail.mock.calls[0][0].html as string;
            expect(html).toContain('기관 신청이 승인되지 않았습니다');
            expect(html).not.toContain('이렇게 해 주세요');
        });

        it('이미 승인된 기관 안내는 머리글을 바꾸고 초대 코드로 가입하는 방법을 적는다', async () => {
            mockSendMail.mockResolvedValue({});

            await sendRejectionEmail('a@org.kr', '기관', '중복', DUPLICATE_APPROVED_EMAIL);

            const html = mockSendMail.mock.calls[0][0].html as string;
            expect(html).toContain('이미 승인된 기관입니다');
            expect(html).not.toContain('기관 신청이 승인되지 않았습니다');
            expect(html).toContain('이렇게 해 주세요');
            expect(html).toContain('초대 코드');
            expect(html).toContain('https://drivelog.socialprism.co.kr');
        });

        it('안내 문구도 HTML 이스케이프한다', async () => {
            mockSendMail.mockResolvedValue({});

            await sendRejectionEmail('a@org.kr', '기관', '사유', { title: '<i>t</i>', guidance: ['<img src=x>'] });

            const html = mockSendMail.mock.calls[0][0].html as string;
            expect(html).not.toContain('<img src=x>');
            expect(html).not.toContain('<i>t</i>');
            expect(html).toContain('&lt;img src=x&gt;');
        });

        it('SMTP 전송 실패는 false다', async () => {
            mockSendMail.mockRejectedValue(new Error('535 auth failed'));

            await expect(sendRejectionEmail('a@org.kr', '기관', '사유')).resolves.toBe(false);
        });

        it('트랜스포터 생성 실패(설정 누락)도 false다', async () => {
            mockCreateTransporter.mockImplementationOnce(() => { throw new Error('GMAIL_USER 미설정'); });

            await expect(sendRejectionEmail('a@org.kr', '기관', '사유')).resolves.toBe(false);
            expect(mockSendMail).not.toHaveBeenCalled();
        });
    });
});
