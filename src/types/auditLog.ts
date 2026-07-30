/**
 * 접속기록/변경 로그 (Audit Logs) 타입 정의
 *
 * 근거: 개인정보 보호법 제29조 + 시행령 제30조 → 고시 「개인정보의 안전성 확보조치 기준」
 * 제16조(접속기록의 보관 및 점검). 개인정보처리시스템의 접속기록을 1년 이상 보관해야 한다.
 * (5만명 이상 정보주체·고유식별정보·민감정보를 처리하면 2년. 이 서비스는 주민등록번호·
 *  운전면허번호를 수집하지 않고 탑승자란에 이용자 이름을 기록하지 않으므로 1년 기준이다.)
 *
 * Phase 1은 **변경 로그**만 다룬다. Firestore 트리거(Admin SDK)가 기록하므로
 * 클라이언트가 위조하거나 누락시킬 수 없다.
 *
 * ⚠️ 행위자(actorUid) 한계 — Firestore 트리거는 호출자를 알 수 없다.
 * 문서가 스스로 드러내는 경우(생성 시 createdByUid 등)에만 채우고, 그 외에는 null이다.
 * 수정·삭제 행위자 식별은 Phase 2에서 열람 로그·세션 기록과 함께 처리한다.
 */
import type { FirestoreDoc, TimestampField } from './common';

/** 수행업무 (고시 제2조의 '수행업무'에 대응) */
export type AuditAction = 'create' | 'update' | 'delete';

/** 기록 대상 컬렉션 — 개인정보를 담는 컬렉션만 대상으로 한다 */
export type AuditTargetType = 'driveLog' | 'user';

/** 행위자를 어떻게 알아냈는지 — 기록의 신뢰 수준을 스스로 구분한다 */
export type AuditActorSource =
    /** 문서 필드(createdByUid 등)에서 추정 */
    | 'document'
    /** 트리거가 알 수 없음 (수정·삭제) */
    | 'unknown';

export interface AuditLog extends FirestoreDoc {
    /** 멀티테넌트 필터 — 기관 관리자의 점검 조회에 쓰인다 */
    organizationId: string;
    action: AuditAction;
    targetType: AuditTargetType;
    /** 대상 문서 ID */
    targetId: string;
    /**
     * 행위자 계정. 알 수 없으면 null.
     * 이름·이메일이 아니라 uid만 남긴다 — 로그 자체가 또 하나의 개인정보 데이터셋이
     * 되는 순환을 막기 위한 최소수집이다.
     */
    actorUid: string | null;
    actorSource: AuditActorSource;
    /**
     * 처리한 정보주체 uid 목록 (고시의 '처리한 정보주체 정보').
     * driveLog는 운전자, user는 문서 주체 본인.
     */
    subjectUids: string[];
    /**
     * update에서 변경된 필드명 목록. **값은 남기지 않는다.**
     * 값을 남기면 감사 로그가 개인정보 스냅샷이 되어 그 로그도 보호 대상이 된다.
     * 다툼이 되는 것은 "누가 언제 무엇을 고쳤는가"이고 값 자체는 원본 문서에 있다.
     */
    changedFields?: string[];
    at: TimestampField;
    /** TTL 정책 대상 필드 — at + 1년. 콘솔에서 auditLogs 컬렉션에 TTL을 설정해야 동작한다 */
    expiresAt: TimestampField;
}
