import { getFirestore } from "firebase-admin/firestore";

/** 기존 기관 호환을 위해 명시적 false일 때만 Google 캘린더 동기화를 끈다. */
export async function isGoogleCalendarEnabled(organizationId: string | undefined): Promise<boolean> {
    if (!organizationId) return false;

    // getFirestore()는 initializeApp 이후에만 유효하므로 함수 내부에서 지연 호출한다.
    const orgSnap = await getFirestore().collection("organizations").doc(organizationId).get();
    return orgSnap.exists && orgSnap.data()?.googleCalendarEnabled !== false;
}
