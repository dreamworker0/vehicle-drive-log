import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { getStorage } from "firebase-admin/storage";
import { setGlobalOptions } from "firebase-functions/v2";

// 시스템 전역 옵션 - 유휴 리소스 절감 및 불필요한 과금 방지
//
// memory 기본값은 규칙(rules/cloud-functions.md §3.2)대로 256MiB다. 전역이 512MiB이면
// 메모리를 명시하지 않은 함수 20여 개가 전부 두 배 메모리로 떠서 Cloud Run GiB-초를
// 그만큼 더 문다. 부족한 함수만 개별 옵션에서 512MiB/1GiB로 올린다.
// (번들 로드 직후 RSS 실측 약 100MiB — 단순 핸들러에는 256MiB로 충분하다)
setGlobalOptions({ 
    maxInstances: 10, 
    memory: "256MiB", 
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
