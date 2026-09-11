/**
 * AdminEditedBadge — '작성자가 아닌 사람이 이 기록을 고쳤다'는 표시
 *
 * 관리자는 직원의 주유·하이패스 기록을 정정할 수 있다(지출결의서 대조). 그런데 목록에는
 * 여전히 작성자 이름만 보이므로, 표시가 없으면 **직원 눈에는 자기가 적지 않은 숫자가
 * 자기 이름으로** 남는다. 금액은 지출 증빙과 대조하는 값이라 바뀐 사실이 조용히 사라지면
 * 안 된다. 그 최소한의 흔적이 이 배지다.
 *
 * 판정은 `lastEditedByUid`(행위자 스탬프, Rules가 위조를 막는다)와 작성자 UID의 비교다.
 * 본인이 고친 경우에는 아무것도 표시하지 않는다 — 본인 수정은 알릴 일이 아니다.
 */

interface Props {
    /** 마지막 수정자 UID (`lastEditedByUid`) */
    lastEditedByUid?: string;
    /** 기록 작성자 UID (주유원·충전자) */
    ownerUid?: string;
    className?: string;
}

export default function AdminEditedBadge({ lastEditedByUid, ownerUid, className = '' }: Props) {
    if (!lastEditedByUid || !ownerUid || lastEditedByUid === ownerUid) return null;

    return (
        <span
            className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-medium
                bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-400 ${className}`}
            title="작성자가 아닌 관리자가 이 기록을 정정했습니다"
        >
            ✏️ 관리자 수정
        </span>
    );
}
