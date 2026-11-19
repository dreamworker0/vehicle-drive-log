import { z } from 'zod';
import { timestampSchema } from './common';

/**
 * 즐겨찾기(자주 가는 목적지) 스키마.
 *
 * 이 컬렉션은 스키마도 컨버터도 없이 `DocumentData`를 그대로 반환하고 호출부에서
 * `as Favorite[]`로 받아 왔다. 검증이 없는 데다 쓰기 경로가 네 곳(즐겨찾기 관리·예약 폼·
 * 바로 운행·운행일지 폼)으로 갈라져, 같은 컬렉션 안에 **모양이 다른 문서**가 쌓였다.
 * 관리 화면은 `name`+`address`만(주소는 빈 문자열 허용), 운행일지 폼은 `name`+`destination`만
 * 기록해서, 관리 화면에서 별칭만 저장한 즐겨찾기를 운행일지에서 누르면 `destination`이
 * undefined로 들어가 렌더 중 `trim()`에서 폼 전체가 죽었다(Sentry bb1ff67d).
 *
 * 그래서 세 필드의 역할을 여기서 못박는다.
 *  - `name`        별칭. 목록에 굵게 뜨는 이름 (항상 존재)
 *  - `address`     사용자가 입력한 주소. **안 적을 수 있다**
 *  - `destination` 폼에 채울 값 = 주소가 있으면 주소, 없으면 별칭 (항상 비어 있지 않다)
 *
 * `.catch()` 폴백을 쓰는 이유는 다른 도메인과 같다 — 옛 문서 하나 때문에 목록 화면
 * 전체가 깨지면 안 된다. 파싱 실패는 Sentry로 올라간다(createZodConverter의 [Zod] 경고).
 */
export const favoriteSchema = z.object({
    userId: z.string().catch(''),
    /** 별칭 (예: '김OO 어르신 댁') */
    name: z.string().catch(''),
    /**
     * 폼에 채울 목적지 값.
     *
     * `destination`을 기록하지 않던 시절의 문서가 남아 있으므로 읽기 시점에
     * `getFavorites`가 `address || name`으로 보정한다 — 여기서는 비어 있어도 통과시킨다.
     */
    destination: z.string().catch(''),
    /** 사용자가 입력한 주소 (선택) */
    address: z.string().optional().catch(undefined),
    /** 용무 (선택) */
    purpose: z.string().optional().catch(undefined),
    organizationId: z.string().optional().catch(undefined),
    /** 방금 추가해 서버 시각이 아직 없으면 null로 읽힌다 — 실패 대신 undefined로 받는다 */
    createdAt: timestampSchema.optional().catch(undefined),
});

export type FavoriteParsed = z.infer<typeof favoriteSchema>;

/**
 * 자주 쓰는 운행 목적 스키마 (`favoritePurposes` 컬렉션).
 *
 * 목적지 즐겨찾기와 같은 개인 범위 데이터다 — 본인만 읽고 쓴다(Rules). 목적은 행선지와
 * 따로 바뀌는 경우가 많아(같은 '병원 동행'이라도 병원은 매번 다르다) 즐겨찾기 문서의
 * `purpose` 칸에 붙이지 않고 별도 컬렉션으로 둔다.
 *
 * 사용자 문서(users)에 배열로 두지 않은 이유: 사용자 문서는 같은 기관 직원 모두가 읽을 수
 * 있고, 목적 문구에는 이용자 이름이 섞일 수 있다(예: '김OO 어르신 병원 동행').
 *
 * `organizationId`는 기관 해지 시 일괄 삭제(purgeOrganizationData)를 위해 함께 남긴다.
 */
export const favoritePurposeSchema = z.object({
    userId: z.string().catch(''),
    /** 목적 문구 (예: '가정방문') */
    text: z.string().catch(''),
    organizationId: z.string().optional().catch(undefined),
    /**
     * `serverTimestamp()`로 저장한 직후 다시 읽으면(추가 → 캐시 무효화 → 재조회) 서버 확정 전의
     * 로컬 쓰기가 결과에 섞여 `createdAt`이 **null**로 온다. `.optional()`은 undefined만
     * 받으므로 이 순간마다 [Zod] 실패가 Sentry로 올라갔다(JAVASCRIPT-REACT-6T).
     * undefined로 받으면 getFavoritePurposes의 정렬이 '아직 시각 없음 = 맨 뒤'로 처리한다.
     */
    createdAt: timestampSchema.optional().catch(undefined),
});

export type FavoritePurposeParsed = z.infer<typeof favoritePurposeSchema>;
