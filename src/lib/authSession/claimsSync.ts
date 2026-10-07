/**
 * 사용자 문서의 role·organizationId와 ID 토큰의 Custom Claims를 맞춘다.
 *
 * Firestore Rules는 Claims(role·orgId)로 권한을 판단하는데, Claims는 서버 트리거가 문서
 * 변경 뒤에 갱신한다. 클라이언트가 들고 있는 토큰은 그 갱신을 모르므로 여기서 새로 받는다.
 */
import type { User as FirebaseUser } from 'firebase/auth';
import { refreshToken, refreshTokenSilently } from '../tokenRefresh';
import { useToastStore } from '../../store/useToastStore';

/** 직전에 본 role/orgId — 초기 로드인지, 권한이 바뀌었는지 가른다 */
export type PrevClaims = { role?: string; orgId?: string };

/**
 * 사용자 문서 스냅샷을 받을 때마다 부른다. 반환값은 다음 호출에 넘길 PrevClaims다.
 *
 * - 초기 로드: 캐시된 토큰의 Claims와 문서가 다르면 백그라운드에서 갱신한다. 첫 쿼리가
 *   permission-denied를 받으면 onSnapshot 오류 처리의 재시도+갱신이 자동 복구하므로
 *   로딩을 막지 않는다.
 * - 이후 role/orgId 변경: fire-and-forget으로 갱신하고, 실패하면 재로그인을 안내한다.
 */
export function syncClaimsWithUserDoc(
    firebaseUser: FirebaseUser,
    data: { role?: string; organizationId?: string | null },
    prev: PrevClaims,
): PrevClaims {
    const isInitialLoad = prev.role === undefined;
    const isClaimsChanged = !isInitialLoad && (prev.role !== data.role || prev.orgId !== data.organizationId);
    const next: PrevClaims = { role: data.role, orgId: data.organizationId || undefined };

    if (isInitialLoad) {
        firebaseUser.getIdTokenResult(false)
            .then(tokenResult => {
                const claims = tokenResult.claims;
                if (claims.orgId !== data.organizationId || claims.role !== data.role) {
                    console.debug('[Auth] 로컬 Claims 불일치 감지. 백그라운드 토큰 갱신');
                    return refreshToken(firebaseUser);
                }
            })
            .catch(() => {});
    } else if (isClaimsChanged) {
        refreshTokenSilently(firebaseUser, () => {
            useToastStore.getState().showToast(
                '권한 정보 갱신에 실패했습니다. 다시 로그인해 주세요.',
                'warning'
            );
        });
    }

    return next;
}

/** 문서가 방금(5초 안) 만들어졌는지 — 가입 직후 문서면 useAuth가 기관 구독을 500ms 늦춘다 */
export function isRecentlyCreated(createdAt: unknown, withinMs = 5000): boolean {
    const createdMillis = (createdAt && typeof createdAt === 'object' && 'toMillis' in createdAt)
        ? (createdAt as { toMillis: () => number }).toMillis()
        : (createdAt instanceof Date ? createdAt.getTime() : 0);
    return createdMillis > 0 && (Date.now() - createdMillis) < withinMs;
}
