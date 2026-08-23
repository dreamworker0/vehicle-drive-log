/**
 * calendarIdFromUrl.test.ts — 캘린더 URL에서 ID 추출 (2026-08-23 정리 작업)
 *
 * 이 함수의 판정이 "고친다 / 비운다"를 가른다. 잘못 뽑으면 그 기관이 엉뚱한 캘린더를
 * 가리키게 되고, 못 뽑으면 복구 가능한 설정을 지운다. 그래서 실제 프로덕션에서 나온
 * 네 가지 실물 형태를 그대로 고정한다.
 */
import { describe, it, expect } from 'vitest';
import { calendarIdFromUrl, looksLikeCalendarId } from '../lib/calendarIdFromUrl';

describe('calendarIdFromUrl — 실물 형태 (프로덕션에서 나온 값)', () => {
    it('embed?src= 의 그룹 캘린더 ID를 뽑는다', () => {
        expect(calendarIdFromUrl(
            'https://calendar.google.com/calendar/embed?src=c_598fc366ba2ee897874771dacf52f2d01161a97bff61216d5a557962af6f26e3%40group.calendar.google.com&ctz=Asia%2FSeoul'
        )).toBe('c_598fc366ba2ee897874771dacf52f2d01161a97bff61216d5a557962af6f26e3@group.calendar.google.com');
    });

    it('embed?src= 의 리소스 캘린더 ID를 뽑는다', () => {
        expect(calendarIdFromUrl(
            'https://calendar.google.com/calendar/embed?src=c_1888e3kkhot7ij5blsp13jl2rctve%40resource.calendar.google.com&ctz=Asia%2FSeoul'
        )).toBe('c_1888e3kkhot7ij5blsp13jl2rctve@resource.calendar.google.com');
    });

    it('ical 공개 주소의 경로 세그먼트에서 뽑는다', () => {
        expect(calendarIdFromUrl(
            'https://calendar.google.com/calendar/ical/main%40woorideul2004.or.kr/public/basic.ics'
        )).toBe('main@woorideul2004.or.kr');
    });

    it('캘린더 ID가 없는 화면 URL은 null — 복구할 것이 없으므로 비운다', () => {
        expect(calendarIdFromUrl('https://calendar.google.com/calendar/u/0/r/month/2026/8/1')).toBeNull();
        expect(calendarIdFromUrl('https://calendar.google.com/calendar/u/0/r')).toBeNull();
    });
});

describe('calendarIdFromUrl — 보수적 판별', () => {
    it('URL이 아니면 null (이미 올바른 캘린더 ID를 건드리지 않는다)', () => {
        expect(calendarIdFromUrl('main@example.or.kr')).toBeNull();
        expect(calendarIdFromUrl('c_abc@group.calendar.google.com')).toBeNull();
        expect(calendarIdFromUrl('')).toBeNull();
    });

    it('구글 캘린더 호스트가 아니면 null', () => {
        expect(calendarIdFromUrl('https://evil.example.com/calendar/embed?src=x%40group.calendar.google.com')).toBeNull();
        expect(calendarIdFromUrl('https://calendar.google.com.evil.example/calendar/embed?src=x%40y.com')).toBeNull();
    });

    it('서비스 계정 주소가 src에 있어도 뽑지 않는다', () => {
        expect(calendarIdFromUrl(
            'https://calendar.google.com/calendar/embed?src=1066541065552-compute%40developer.gserviceaccount.com'
        )).toBeNull();
    });

    it('깨진 URL·ID 모양이 아닌 src는 null', () => {
        expect(calendarIdFromUrl('https://calendar.google.com/calendar/embed?src=not-an-id')).toBeNull();
        expect(calendarIdFromUrl('http://')).toBeNull();
    });
});

describe('looksLikeCalendarId', () => {
    it('@가 있고 경로·공백이 없는 값만 인정한다', () => {
        expect(looksLikeCalendarId('main@woorideul2004.or.kr')).toBe(true);
        expect(looksLikeCalendarId('c_abc@group.calendar.google.com')).toBe(true);
        expect(looksLikeCalendarId('no-at-sign')).toBe(false);
        expect(looksLikeCalendarId('has space@x.com')).toBe(false);
        expect(looksLikeCalendarId('with/slash@x.com')).toBe(false);
        expect(looksLikeCalendarId('sa@developer.gserviceaccount.com')).toBe(false);
    });
});
