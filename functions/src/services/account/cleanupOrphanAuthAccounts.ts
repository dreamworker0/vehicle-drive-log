/**
 * cleanupOrphanAuthAccounts — 기관에 소속되지 않은 채 오래 쓰이지 않은 로그인 계정을 정리한다
 *
 * ## 왜 필요한가
 * 처리방침 제9조는 기관을 삭제하면 "소속 사용자 정보"를 파기한다고 약속한다. 그런데 기관 해지는
 * Firestore의 users 문서만 지우고(withdrawOrganization), 30일 뒤 파기(purgeOrganizationData)도
 * **Firebase Auth 계정(이메일·이름·사진)은 건드리지 않았다.** 로그인만 하고 기관에 가입하지 않은
 * 사람, 운영자가 지운 직원의 계정도 같은 모양으로 남는다. 2026-11-11 운영 조회에서 계정 2,306개 중
 * 167개가 users 문서 없이 남아 있었다(90일 넘게 로그인 없음 115개). 세 경우를 기록으로 가를 수 없어
 * 원인별로 지우지 않고 **"소속 없음 + 오래 쓰지 않음"** 한 기준으로 정리한다.
 *
 * ## 대상
 * - Firestore `users/{uid}` 문서가 없다 (어느 기관에도 소속되지 않았다)
 * - 마지막 활동(로그인·토큰 갱신·생성 중 가장 최근)이 INACTIVE_DAYS보다 오래됐다 — 실수로 해지했다가
 *   복구하거나 다른 기관에 다시 가입하는 사람을 보호한다. 다시 로그인하면 활동 시각이 갱신된다.
 * - superAdmin 클레임이 없다 (운영자 계정은 어떤 경우에도 지우지 않는다)
 *
 * ## 함께 지우는 것
 * uid로만 묶여 기관 파기가 지우지 못하던 데이터 — 즐겨찾기(userId)·알림(targetUid)·의견 첨부
 * (Storage `feedbacks/{uid}/`, `feedbacks/ocr-report/{uid}/`). purgeOrganizationData 머리 주석의
 * "이 함수가 지우지 못하는 것"에 적혀 있던 항목이다.
 *
 * ## 기본은 보고만 한다
 * 계정 삭제는 되돌릴 수 없다. `system/authCleanup` 문서의 `deleteEnabled`가 `true`일 때만 지우고,
 * 그 전에는 대상 수만 같은 문서에 남긴다. 운영자는 보고를 보고 처리방침 문구를 정한 뒤 콘솔에서 켠다.
 * 한 번에 MAX_DELETE_PER_RUN개까지만 지운다 — 판정이 잘못됐을 때 피해를 묶어 둔다.
 * 지우기 직전에 users 문서가 생겼는지 한 번 더 확인한다(그사이 가입한 사람).
 */
import type { Auth, UserRecord } from "firebase-admin/auth";
import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import type { PurgeBucket } from "../organization/purgeOrganizationData";

/** 소속 없이 이 기간 넘게 활동이 없으면 정리 대상이다 */
export const INACTIVE_DAYS = 90;
/** 한 번 실행에 지우는 계정 상한 */
export const MAX_DELETE_PER_RUN = 300;
/** 운영 스위치·보고 문서 */
export const CLEANUP_DOC = "system/authCleanup";

const DAY_MS = 86_400_000;
/** Auth `deleteUsers`·Firestore `getAll`에 한 번에 넘기는 개수 */
const CHUNK = 100;

export interface AuthAccountLite {
    uid: string;
    /** 마지막 활동 시각(ms) — 로그인·토큰 갱신·생성 중 가장 최근 */
    lastActiveMs: number;
    isSuperAdmin: boolean;
}

/** Auth 계정 기록을 판정에 필요한 모양으로 줄인다 */
export function toAccountLite(user: Pick<UserRecord, "uid" | "metadata" | "customClaims">): AuthAccountLite {
    const times = [user.metadata.lastSignInTime, user.metadata.lastRefreshTime, user.metadata.creationTime]
        .map((t) => (t ? Date.parse(t) : NaN))
        .filter((t) => Number.isFinite(t));
    return {
        uid: user.uid,
        lastActiveMs: times.length > 0 ? Math.max(...times) : 0,
        isSuperAdmin: user.customClaims?.role === "superAdmin",
    };
}

/** 정리 대상 고르기 — 순수 함수 */
export function selectOrphanAccounts(
    accounts: AuthAccountLite[],
    existingUserIds: ReadonlySet<string>,
    nowMs: number,
    inactiveDays = INACTIVE_DAYS,
): AuthAccountLite[] {
    const cutoff = nowMs - inactiveDays * DAY_MS;
    return accounts.filter((a) =>
        !existingUserIds.has(a.uid) && !a.isSuperAdmin && a.lastActiveMs < cutoff);
}

export interface OrphanCleanupResult {
    mode: "report" | "delete";
    totalAccounts: number;
    candidates: number;
    deleted: number;
    /** 지우기 직전 users 문서가 생겨 건너뛴 계정 */
    skippedJoined: number;
    failed: number;
}

async function deleteQuery(db: Firestore, collection: string, field: string, uid: string): Promise<number> {
    const snap = await db.collection(collection).where(field, "==", uid).get();
    if (snap.empty) return 0;
    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    return snap.size;
}

export async function cleanupOrphanAuthAccounts(
    deps: { auth: Pick<Auth, "listUsers" | "deleteUsers">; db: Firestore; bucket: PurgeBucket },
    nowMs = Date.now(),
): Promise<OrphanCleanupResult> {
    const { auth, db, bucket } = deps;

    const existingUserIds = new Set((await db.collection("users").select().get()).docs.map((d) => d.id));
    const accounts: AuthAccountLite[] = [];
    let pageToken: string | undefined;
    do {
        const page = await auth.listUsers(1000, pageToken);
        accounts.push(...page.users.map(toAccountLite));
        pageToken = page.pageToken;
    } while (pageToken);

    const candidates = selectOrphanAccounts(accounts, existingUserIds, nowMs);
    const config = (await db.doc(CLEANUP_DOC).get()).data() ?? {};
    const deleteEnabled = config.deleteEnabled === true;

    const result: OrphanCleanupResult = {
        mode: deleteEnabled ? "delete" : "report",
        totalAccounts: accounts.length,
        candidates: candidates.length,
        deleted: 0,
        skippedJoined: 0,
        failed: 0,
    };

    if (deleteEnabled) {
        const targets = candidates.slice(0, MAX_DELETE_PER_RUN).map((a) => a.uid);
        for (let i = 0; i < targets.length; i += CHUNK) {
            const chunk = targets.slice(i, i + CHUNK);
            // 지우기 직전 재확인 — 목록을 읽은 뒤 가입한 사람은 건너뛴다
            const snaps = await db.getAll(...chunk.map((uid) => db.collection("users").doc(uid)));
            const stillOrphan = chunk.filter((_, idx) => !snaps[idx].exists);
            result.skippedJoined += chunk.length - stillOrphan.length;
            if (stillOrphan.length === 0) continue;

            // 계정을 먼저 지운다 — 남은 데이터 정리가 중간에 실패해도 다음 주에 같은 uid로는
            // 다시 찾을 수 없으므로, 데이터 정리는 계정 삭제가 성공한 uid에만 이어서 한다.
            const res = await auth.deleteUsers(stillOrphan);
            const failedIdx = new Set(res.errors.map((e) => e.index));
            result.failed += res.failureCount;
            const deletedUids = stillOrphan.filter((_, idx) => !failedIdx.has(idx));
            result.deleted += deletedUids.length;

            for (const uid of deletedUids) {
                try {
                    await deleteQuery(db, "favorites", "userId", uid);
                    await deleteQuery(db, "notifications", "targetUid", uid);
                    await bucket.deleteFiles({ prefix: `feedbacks/${uid}/` });
                    await bucket.deleteFiles({ prefix: `feedbacks/ocr-report/${uid}/` });
                } catch (error) {
                    // 계정은 이미 지워졌다 — 남은 조각은 로그로 남기고 다음 계정으로 간다
                    console.error(`[cleanupOrphanAuthAccounts] uid 데이터 정리 실패: ${uid}`, (error as Error).message);
                }
            }
        }
    }

    await db.doc(CLEANUP_DOC).set({
        lastRunAt: FieldValue.serverTimestamp(),
        lastResult: { ...result, inactiveDays: INACTIVE_DAYS },
    }, { merge: true });
    console.log(`[cleanupOrphanAuthAccounts] ${JSON.stringify(result)}`);
    return result;
}
