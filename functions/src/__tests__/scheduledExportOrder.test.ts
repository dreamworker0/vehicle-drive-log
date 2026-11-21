/**
 * scheduledExportOrder.test.ts
 *
 * 예약(onSchedule) 함수가 index.ts **앞쪽**에 등록돼 있는지 지킨다.
 *
 * firebase-tools는 index.ts의 export 순서대로 함수를 갱신한다. 함수가 80개를 넘으면서 뒤쪽
 * (50번째 안팎부터)은 Cloud Functions 분당 갱신 한도(429)가 터지는 구간이 됐다. 그 구간에서는
 * 갱신이 끝난 응답에 Cloud Run 서비스 정보가 빠지거나("Updated function is not associated with a
 * service"), 서비스 IAM 조회가 실패한다.
 * - 일반 함수는 그래도 무해하다(이미 설정된 호출 권한이 남아 있다).
 * - 예약 함수는 갱신 뒤에 예약 작업 URL과 호출 권한을 다시 설정해야 해서 **배포가 실패**한다
 *   (`URL cannot be empty` 400 또는 `Failed to get the IAM Policy on the Service`).
 *
 * 실제로 `sendInactiveOrgAlimtalkScheduled`가 54번째에 있을 때 11-15·11-19(2회)·11-21 배포가
 * 이 함수 하나로 실패했다. 다른 예약 함수 6개는 30번째 안에 있어 한 번도 걸리지 않았다.
 * 근거 코드: firebase-tools `lib/deploy/functions/release/fabricator.js`의 updateV2Function.
 *
 * index.ts를 import하면 firebase-admin 초기화까지 끌려오므로 소스를 직접 읽는다(auditLog.test.ts와 같은 방식).
 */
import * as fs from "fs";
import * as path from "path";

/** 이 순번 안에서 갱신이 끝나야 한도 구간을 피한다. 한도(분당 60회)의 절반으로 여유를 둔다. */
const SAFE_SLOTS = 30;

const INDEX_SRC = fs.readFileSync(path.join(__dirname, "..", "index.ts"), "utf-8");
const SCHEDULED_DIR = path.join(__dirname, "..", "handlers", "scheduled");

/** index.ts의 export를 순서대로 펼친다 — 한 줄에 여러 이름을 내보내는 경우도 하나씩 센다. */
function exportedFunctions(): { name: string; from: string }[] {
    const out: { name: string; from: string }[] = [];
    const re = /^export\s*\{([^}]*)\}\s*from\s*"([^"]+)";/gms;
    for (const m of INDEX_SRC.matchAll(re)) {
        for (const raw of m[1].split(",")) {
            const name = raw.trim().split(/\s+as\s+/).pop();
            if (name) out.push({ name, from: m[2] });
        }
    }
    return out;
}

/** handlers/scheduled 안에서 onSchedule로 만든 함수 이름 */
function scheduledFunctionNames(): string[] {
    const names: string[] = [];
    for (const file of fs.readdirSync(SCHEDULED_DIR)) {
        if (!file.endsWith(".ts")) continue;
        const src = fs.readFileSync(path.join(SCHEDULED_DIR, file), "utf-8");
        for (const m of src.matchAll(/export const (\w+)\s*=\s*onSchedule\(/g)) names.push(m[1]);
    }
    return names;
}

describe("예약 함수 등록 순서", () => {
    const exported = exportedFunctions();
    const scheduled = scheduledFunctionNames();

    it("export 목록과 예약 함수 목록을 제대로 읽는다", () => {
        // 파싱이 깨져 빈 목록으로 통과하는 것을 막는다
        expect(exported.length).toBeGreaterThan(50);
        expect(scheduled).toEqual(expect.arrayContaining([
            "nightlyStatsBatch", "dailyNightlyBatch", "weeklyMaintenanceBatch", "monthlyBatch",
            "sendInactiveOrgAlimtalkScheduled", "reservationReminder", "syncCalendarToApp",
        ]));
    });

    it.each(scheduledFunctionNames())("%s는 앞쪽에 등록돼 있다 — 갱신 한도 구간을 피한다", (name) => {
        const position = exported.findIndex((e) => e.name === name) + 1;
        expect(position).toBeGreaterThan(0); // 등록 자체가 빠지면 배포되지 않는다
        expect(position).toBeLessThanOrEqual(SAFE_SLOTS);
    });
});
