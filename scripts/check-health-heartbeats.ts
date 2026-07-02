/**
 * check-health-heartbeats — 스케줄러 heartbeat(_health) 진단 (읽기 전용)
 *
 * _health/{reservationReminder,syncCalendarToApp,syncHolidays}의 lastRun을 읽어
 * KST 시각과, apiHealthCheck의 새 판정(활성 창 기준)이 ok/error 중 무엇이어야 하는지 출력한다.
 * ADC(GOOGLE_APPLICATION_CREDENTIALS) 인증, 쓰기 없음.
 */
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

initializeApp({ credential: applicationDefault() });
const db = getFirestore();

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
function toKST(d: Date) { return new Date(d.getTime() + KST_OFFSET_MS); }
function fmtKST(ms: number) {
    const k = toKST(new Date(ms));
    const wd = ['일', '월', '화', '수', '목', '금', '토'][k.getUTCDay()];
    return `${k.getUTCFullYear()}-${String(k.getUTCMonth() + 1).padStart(2, '0')}-${String(k.getUTCDate()).padStart(2, '0')}(${wd}) ${String(k.getUTCHours()).padStart(2, '0')}:${String(k.getUTCMinutes()).padStart(2, '0')}:${String(k.getUTCSeconds()).padStart(2, '0')} KST`;
}

interface Win { days: number[]; startHour: number; endHour: number; }
const CONFIG: { name: string; win?: Win }[] = [
    { name: 'reservationReminder', win: { days: [1, 2, 3, 4, 5], startHour: 8, endHour: 18 } },
    { name: 'syncCalendarToApp', win: { days: [1, 2, 3, 4, 5], startHour: 6, endHour: 22 } },
    { name: 'syncHolidays' },
];

// apiHealthCheck.ts와 동일 로직 재현 (KST 판정)
function lastTick(nowMs: number, win: Win): number | null {
    const H = 3600000;
    for (let i = 0; i < 8 * 24; i++) {
        const t = nowMs - i * H;
        const k = toKST(new Date(t));
        if (win.days.includes(k.getUTCDay()) && k.getUTCHours() >= win.startHour && k.getUTCHours() <= win.endHour) {
            return Math.floor(t / H) * H;
        }
    }
    return null;
}

async function main() {
    const nowMs = Date.now();
    console.log(`현재: ${fmtKST(nowMs)}  (epoch ${nowMs})\n`);

    for (const c of CONFIG) {
        const doc = await db.collection('_health').doc(c.name).get();
        const lr = doc.data()?.lastRun;
        const lastRunMs = lr?.toDate ? lr.toDate().getTime() : (lr ? new Date(lr).getTime() : null);

        console.log(`■ ${c.name}`);
        if (lastRunMs === null) { console.log('  lastRun: 없음 → degraded\n'); continue; }
        console.log(`  lastRun: ${fmtKST(lastRunMs)}`);
        const elapsedMin = Math.round((nowMs - lastRunMs) / 60000);
        console.log(`  경과: ${elapsedMin}분`);

        if (c.win) {
            const tick = lastTick(nowMs, c.win)!;
            console.log(`  직전 예정 틱: ${fmtKST(tick)}`);
            const GRACE = 15 * 60 * 1000;
            let status: string;
            if (nowMs - tick < GRACE) status = 'ok(유예)';
            else status = lastRunMs >= tick ? 'ok' : 'error';
            console.log(`  판정(새 로직): ${status}  [lastRun ${lastRunMs >= tick ? '>=' : '<'} tick]\n`);
        } else {
            console.log(`  (상시) 판정 생략\n`);
        }
    }
}

main().catch((e) => { console.error(e); process.exit(1); });
