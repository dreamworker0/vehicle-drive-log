/**
 * actorStamp — 접속기록의 '계정' 항목을 남기는 행위자 스탬프
 *
 * 근거: 고시 「개인정보의 안전성 확보조치 기준」 제16조가 요구하는 항목은
 * 계정·일시·접속지·정보주체·수행업무다. Phase 1(접속기록 트리거)은 일시·정보주체·
 * 수행업무만 채웠고 **계정이 수정·삭제에서 공백**이었다 — Firestore 트리거는
 * 호출자를 알 수 없기 때문이다.
 *
 * ## 왜 클라이언트가 심는 값을 신뢰할 수 있나
 * Rules의 `actorStampValid()`가 이 필드의 변경을 `request.auth.uid`와 대조한다.
 * 즉 심는 주체는 클라이언트지만 **타인 명의로 심을 수는 없다**. 덕분에 모든 쓰기를
 * 콜러블로 옮기거나 오프라인 큐 구조를 바꾸지 않고도 행위자를 확정할 수 있다.
 *
 * ## 한계 — 삭제에는 쓰지 않는다
 * 삭제된 문서에 남은 값은 마지막 '수정자'이지 '삭제자'가 아니다. 이를 삭제자로
 * 기록하면 무고한 사용자에게 책임이 귀속되며, 그것은 `unknown`보다 나쁘다
 * (Phase 123의 restoreUser 행위자 오기재와 같은 함정).
 *
 * 로그인하지 않은 상태에서는 빈 객체를 돌려준다 — 없는 값을 지어내지 않는다.
 */
import { auth } from '../firebase';

/** 현재 로그인 사용자를 마지막 수정자로 기록하는 필드 조각. */
export function actorStamp(): { lastEditedByUid?: string } {
    const uid = auth.currentUser?.uid;
    return uid ? { lastEditedByUid: uid } : {};
}
