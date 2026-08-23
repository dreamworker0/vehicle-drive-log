/**
 * calendarIdFromUrl — 구글 캘린더 URL에서 캘린더 ID를 추출한다 (순수 함수)
 *
 * 왜 필요한가: 차량의 '캘린더 ID' 칸에 **캘린더 화면 URL을 그대로 붙여 넣은** 기관이
 * 다수 있었다(2026-08-23 정리 조회에서 4개 기관·차량 11대). 그 값들은 `@`가 없어
 * 동기화가 건너뛰지만, **URL 안에는 진짜 캘린더 ID가 URL 인코딩된 채 들어 있다.**
 *
 *   https://calendar.google.com/calendar/embed?src=c_abc%40group.calendar.google.com&ctz=...
 *                                                 └─ c_abc@group.calendar.google.com ─┘
 *   https://calendar.google.com/calendar/ical/main%40example.or.kr/public/basic.ics
 *                                            └── main@example.or.kr ──┘
 *
 * 그래서 이 값들은 "지울 대상"이 아니라 "고칠 대상"이다. 반면 캘린더 ID가 아예 없는 URL
 * (예: `/calendar/u/0/r/month/2026/8/1` — 그냥 월 보기 화면)은 복구할 것이 없어 비운다.
 *
 * 판별을 보수적으로 한다 — 구글 캘린더 호스트가 아니거나 ID 모양이 아니면 null을 준다.
 * 잘못 추출한 값을 쓰면 그 기관이 남의 캘린더를 가리키게 될 수 있다(서버 바인딩이 막지만,
 * 애초에 만들지 않는 것이 맞다).
 */

/** 구글 캘린더 URL로 인정하는 호스트 */
const CALENDAR_HOSTS = new Set(["calendar.google.com", "www.calendar.google.com"]);

/**
 * 캘린더 ID로 인정할 모양인가.
 *
 * `@`를 포함하고(동기화 경로의 최소 조건), 공백·경로 구분자가 없어야 한다.
 * 서비스 계정 주소는 어느 기관의 캘린더도 아니므로 여기서도 거절한다
 * (functions/src/services/calendar/calendarBinding.ts와 같은 기준).
 */
export function looksLikeCalendarId(value: string): boolean {
    const v = value.trim();
    if (!v.includes("@")) return false;
    if (/[\s/?#]/.test(v)) return false;
    if (v.toLowerCase().endsWith(".gserviceaccount.com")) return false;
    // 이메일형(main@example.or.kr) 또는 구글 캘린더형(c_xxx@group.calendar.google.com)
    return /^[^@]+@[^@]+\.[^@]+$/.test(v);
}

/**
 * 구글 캘린더 URL에서 캘린더 ID를 뽑는다. 뽑을 수 없으면 null.
 *
 * 지원 형태:
 *  - `?src=<urlencoded id>`            (embed / htmlembed / r?cid= 계열의 src)
 *  - `/calendar/ical/<urlencoded id>/` (ical 공개 주소)
 *  - `?cid=<urlencoded id>`            (구독 링크. base64 cid는 인정하지 않는다)
 */
export function calendarIdFromUrl(raw: string): string | null {
    const trimmed = raw.trim();
    if (!/^https?:\/\//i.test(trimmed)) return null;

    let url: URL;
    try {
        url = new URL(trimmed);
    } catch {
        return null;
    }
    if (!CALENDAR_HOSTS.has(url.hostname.toLowerCase())) return null;

    // 1) src / cid 쿼리 파라미터 (URL 객체가 이미 디코드해서 준다)
    for (const key of ["src", "cid"]) {
        const value = url.searchParams.get(key);
        if (value && looksLikeCalendarId(value)) return value.trim();
    }

    // 2) /calendar/ical/<id>/public/basic.ics 형태의 경로 세그먼트
    const segments = url.pathname.split("/").filter(Boolean);
    const icalIdx = segments.indexOf("ical");
    if (icalIdx >= 0 && segments.length > icalIdx + 1) {
        let candidate: string;
        try {
            candidate = decodeURIComponent(segments[icalIdx + 1]);
        } catch {
            return null;
        }
        if (looksLikeCalendarId(candidate)) return candidate.trim();
    }

    return null;
}
