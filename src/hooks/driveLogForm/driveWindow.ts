import type { DriveLogForm } from './types';

/**
 * driveWindow — 운행의 시작·끝 시각이 말이 되는지 본다.
 *
 * 이 검증은 원래 **아무 데도 없었다.** 도착 시각이 출발보다 일러도 조용히 저장됐고,
 * 그때 `buildDriveTimestamp`가 만드는 timestamp는 실제 운행보다 이른 시각을 가리켰다
 * (정렬·집계·소급 판정이 모두 그 값을 쓴다). 이틀 이상 걸린 운행을 표현할 수 없어서
 * 생긴 문제이기도 하고, 단순 오타로도 같은 결과가 나왔다.
 *
 * 이제 도착일(`endDate`)이 있으므로 두 경우를 가를 수 있다:
 *   - 같은 날인데 도착이 이르다 → 오타다. 막는다.
 *   - 다음 날 이후에 도착했다 → 정상이다. 통과시킨다.
 */

/** 'HH:MM' → 분. 형식이 어긋나면 null(검증을 건너뛴다 — 입력 중일 수 있다). */
function toMinutes(time: string): number | null {
    const m = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
    if (!m) return null;
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h > 23 || min > 59) return null;
    return h * 60 + min;
}

/**
 * 출발일·도착일·시각의 앞뒤가 맞는지 본다.
 *
 * @returns 사용자에게 보여 줄 안내 문구. 문제가 없으면 null.
 */
export function validateDriveWindow(form: DriveLogForm): string | null {
    const startDate = form.driveDate;
    // 비어 있으면 같은 날 운행이다(기존 문서 전부가 이 경우다).
    const endDate = form.endDate || startDate;

    if (!startDate) return null;

    if (endDate < startDate) {
        return '도착일이 출발일보다 빠릅니다. 날짜를 확인해 주세요.';
    }

    // 날짜가 다르면 시각의 앞뒤를 따질 필요가 없다 — 다음 날 이후 도착이므로
    // 도착 시각이 출발보다 일러도 정상이다(17:00 출발 → 다음 날 10:00 도착).
    if (endDate !== startDate) return null;

    const start = toMinutes(form.startTime || '');
    const end = toMinutes(form.endTime || '');
    if (start === null || end === null) return null;

    if (end < start) {
        return '도착 시각이 출발 시각보다 빠릅니다. 다음 날 도착이라면 도착일을 바꿔 주세요.';
    }
    return null;
}
