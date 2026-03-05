/**
 * warmupOcr — 근무시간(08~18시) 동안 ocrDashboard 함수를 따뜻하게 유지
 * 
 * 5분마다 실행되며 현재 시각이 08:00~18:00(KST) 범위일 때만
 * ocrDashboard Cloud Function을 가볍게 호출하여 콜드 스타트를 방지합니다.
 */
const { getFunctions } = require("firebase-admin/functions");

/**
 * ocrDashboard 함수에 빈 요청을 보내 인스턴스를 따뜻하게 유지
 * 실제 호출이 아닌 내부 ping이므로 인증 없이 실패해도 무방 (인스턴스 활성화가 목적)
 */
async function warmupOcrFunction() {
    // KST 기준 현재 시각 확인
    const now = new Date();
    const kstHour = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Seoul" })).getHours();

    // 근무시간(08:00~17:59) 외에는 건너뜀
    if (kstHour < 8 || kstHour >= 18) {
        console.log(`warmupOcr: 현재 KST ${kstHour}시, 근무시간 외 → skip`);
        return;
    }

    try {
        // asia-northeast3 리전의 ocrDashboard를 HTTP로 ping
        const projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT;
        const region = "asia-northeast3";
        const functionName = "ocrDashboard";
        const url = `https://${region}-${projectId}.cloudfunctions.net/${functionName}`;

        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ data: {} }),
            signal: AbortSignal.timeout(10000),
        });

        console.log(`warmupOcr: ping → ${response.status} (KST ${kstHour}시)`);
    } catch (err) {
        // 인증 실패(401/403)여도 인스턴스는 활성화되므로 목적 달성
        console.log(`warmupOcr: ping 완료 (${err.message || "ok"}) — 인스턴스 워밍업 성공`);
    }
}

exports.warmupOcrFunction = warmupOcrFunction;
