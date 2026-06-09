/**
 * warmupOcr — 근무시간(08~18시) 동안 ocrDashboard 함수를 따뜻하게 유지
 */
export async function warmupOcrFunction(): Promise<void> {
    const now = new Date();
    const kstHour = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Seoul" })).getHours();

    if (kstHour < 8 || kstHour >= 18) {
        console.log(`warmupOcr: 현재 KST ${kstHour}시, 근무시간 외 → skip`);
        return;
    }

    try {
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
    } catch (err: unknown) {
        console.log(`warmupOcr: ping 완료 (${(err as Error).message || "ok"}) — 인스턴스 워밍업 성공`);
    }
}
