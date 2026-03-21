/**
 * emulator.setup.ts — Firebase 에뮬레이터 통합 테스트 환경 설정
 *
 * 에뮬레이터가 실행 중인 상태에서 테스트를 수행한다.
 * 환경변수를 통해 Admin SDK가 에뮬레이터에 연결되도록 설정.
 */
import { initializeApp, getApps, deleteApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// 에뮬레이터 호스트 설정
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
process.env.GCLOUD_PROJECT = "demo-vehicle-log";

let initialized = false;

/**
 * Admin SDK 초기화 (에뮬레이터 연결)
 * 여러 번 호출해도 안전하게 한 번만 초기화
 */
export function initializeTestApp() {
    if (initialized) return;
    if (getApps().length === 0) {
        initializeApp({ projectId: "demo-vehicle-log" });
    }
    initialized = true;
}

/**
 * Firestore 에뮬레이터 데이터 전체 삭제
 * 각 테스트 전/후에 호출하여 격리 보장
 */
export async function clearFirestoreData() {
    const response = await fetch(
        "http://127.0.0.1:8080/emulator/v1/projects/demo-vehicle-log/databases/(default)/documents",
        { method: "DELETE" }
    );
    if (!response.ok) {
        console.warn("Firestore 데이터 정리 실패:", response.statusText);
    }
}

/**
 * Auth 에뮬레이터 사용자 전체 삭제
 */
export async function clearAuthUsers() {
    const response = await fetch(
        "http://127.0.0.1:9099/emulator/v1/projects/demo-vehicle-log/accounts",
        { method: "DELETE" }
    );
    if (!response.ok) {
        console.warn("Auth 데이터 정리 실패:", response.statusText);
    }
}

/**
 * 테스트용 Firestore 인스턴스
 */
export function getTestFirestore() {
    initializeTestApp();
    return getFirestore();
}

/**
 * 모든 리소스 정리 (afterAll에서 사용)
 */
export async function cleanupAll() {
    await clearFirestoreData();
    await clearAuthUsers();
    const apps = getApps();
    await Promise.all(apps.map((app) => deleteApp(app)));
    initialized = false;
}
