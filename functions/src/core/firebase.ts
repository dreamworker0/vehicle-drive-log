import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { getStorage } from "firebase-admin/storage";
import { setGlobalOptions } from "firebase-functions/v2";

// 시스템 전역 옵션 - 유휴 리소스 절감 및 불필요한 과금 방지
setGlobalOptions({ 
    maxInstances: 10, 
    memory: "512MiB", 
    timeoutSeconds: 120, 
    region: "asia-northeast3",
    concurrency: 80
});

if (getApps().length === 0) {
    initializeApp();
}

export const db = getFirestore();
export const auth = getAuth();
export const storage = getStorage();
