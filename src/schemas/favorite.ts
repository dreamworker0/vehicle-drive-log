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
    createdAt: timestampSchema.optional(),
});

export type FavoriteParsed = z.infer<typeof favoriteSchema>;
