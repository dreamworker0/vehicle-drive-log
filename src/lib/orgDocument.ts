import { getFunctions, httpsCallable } from 'firebase/functions';
import firebaseApp from './firebase';
import type { Organization } from '../types/organization';

const functions = getFunctions(firebaseApp, 'asia-northeast3');

type OrgDocRef = Pick<Organization, 'uniqueNumberImagePath' | 'uniqueNumberImageUrl'>;

/**
 * 조직 증빙서류의 존재 여부. 신규 문서는 경로 필드, 레거시 문서는 토큰 URL을 가진다.
 * (2026-07-18 보안 재검증 P0-3)
 */
export function hasOrgDocument(org: OrgDocRef): boolean {
    return !!(org.uniqueNumberImagePath || org.uniqueNumberImageUrl);
}

/**
 * 조직 증빙서류의 Storage 경로를 해석한다.
 * 신규 문서는 uniqueNumberImagePath, 레거시 문서는 토큰 URL(uniqueNumberImageUrl)에서 역추출한다.
 */
export function resolveOrgDocumentPath(org: OrgDocRef): string | null {
    if (org.uniqueNumberImagePath) return org.uniqueNumberImagePath;
    const match = org.uniqueNumberImageUrl?.match(/\/o\/(.+?)\?/);
    return match ? decodeURIComponent(match[1]) : null;
}

/**
 * 증빙서류 표시용 단기 서명 URL을 발급받는다 (superAdmin 전용 콜러블 getOrgDocumentUrl).
 * URL은 5분 후 만료되므로 저장하지 않고 표시 시점마다 발급한다.
 */
export async function fetchOrgDocumentUrl(orgId: string): Promise<string> {
    const callable = httpsCallable<{ orgId: string }, { url: string }>(
        functions,
        'getOrgDocumentUrl',
        { timeout: 30000 },
    );
    const result = await callable({ orgId });
    return result.data.url;
}
