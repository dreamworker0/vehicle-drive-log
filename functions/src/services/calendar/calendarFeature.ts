import { getFirestore } from "firebase-admin/firestore";

const db = getFirestore();

/** 기존 기관 호환을 위해 명시적 false일 때만 Google 캘린더 동기화를 끈다. */
export async function isGoogleCalendarEnabled(organizationId: string | undefined): Promise<boolean> {
    if (!organizationId) return false;

    const orgSnap = await db.collection("organizations").doc(organizationId).get();
    return orgSnap.exists && orgSnap.data()?.googleCalendarEnabled !== false;
}
