#!/usr/bin/env node
import { initializeApp, applicationDefault } from 'firebase-admin/app';

try {
    initializeApp({ credential: applicationDefault() });
} catch (e) {
    console.error('❌ Firebase 인증 실패', e);
    process.exit(1);
}

// computeDashboardStats import 시 ts-node/tsx에서 경로 해석에 유의.
import { computeAllDashboardStats } from '../functions/lib/caching/computeDashboardStats.js';

async function main() {
    console.log("Starting computeAllDashboardStats...");
    await computeAllDashboardStats();
    console.log("Done.");
}

main().catch(err => {
    console.error('❌ 오류:', err.message);
    process.exit(1);
});
