/**
 * 접속기록/변경 로그 (Audit Logs) 타입 정의
 *
 * 근거: 개인정보 보호법 제29조 + 시행령 제30조 → 고시 「개인정보의 안전성 확보조치 기준」
 * 제16조(접속기록의 보관 및 점검). 개인정보처리시스템의 접속기록을 1년 이상 보관해야 한다.
 *
 * ## 보관기간을 1년으로 잡은 근거
 * 2년 요건은 ①정보주체 5만명 이상 ②고유식별정보 ③민감정보 중 하나에 해당할 때다.
 * - 고유식별정보(주민등록번호·여권번호·운전면허번호·외국인등록번호)를 수집하지 않는다.
 * - 민감정보(건강·유전·범죄경력·사상·노조 가입 등)를 수집하지 않는다.
 * - 정보주체는 기관별 직원 규모(200여 기관)로 총계 5만명에 미달한다.
 *
 * ⚠️ 탑승자 이름은 실제로 저장된다 — driveLogs의 `passengerNames`(조직원 + 외부 이용자).
 * 이름과 목적지의 조합은 취급에 주의가 필요한 개인정보지만 민감정보에는 해당하지 않으므로
 * 위 판단은 유지된다. 다만 정보주체 총수가 5만명에 근접하면 2년으로 재검토해야 한다.
 *
 * Phase 1은 **변경 로그**만 다룬다. 기록 대상은 개인정보 필드와 접근 권한 필드의 변경으로
 * 한정한다(화이트리스트) — 근거는 functions/src/handlers/triggers/auditLog.ts 주석 참고.
 *
 * ⚠️ 행위자(actorUid) 한계 — Firestore 트리거는 호출자를 알 수 없다.
 * Phase 2 ①에서 클라이언트가 `lastEditedByUid`를 심고 Rules가 인증 토큰과의 일치를
 * 강제하는 방식으로 **수정** 행위자를 확정했다(actorSource: 'stamp'). 남은 공백은
 * **삭제** 행위자다 — 남은 스탬프는 마지막 수정자이지 삭제자가 아니므로 쓰지 않는다.
 */
import type { FirestoreDoc, TimestampField } from './common';

/**
 * 수행업무 (고시 제2조의 '수행업무'에 대응)
 *
 * `create`·`update`·`delete`는 Firestore 트리거(변경 로그), `login`은 세션 기록,
 * `export`는 반출 기록, `read`는 superAdmin의 기관 증빙서류 열람이 쓴다.
 *
 * ⚠️ 서버가 쓰는 값을 하나라도 빠뜨리면 안 된다 — Zod 스키마가 `.catch('update')`로
 * 알 수 없는 값을 삼키므로, 빠진 값은 조회 화면에서 **다른 수행업무로 표시된다**
 * (반출 기록이 '수정'으로 보이는 식). 서버는 `services/audit/writeAuditEntry.ts`와
 * `handlers/triggers/auditLog.ts` 두 곳에서만 쓰므로 그 둘과 함께 갱신한다.
 */
export type AuditAction = 'create' | 'update' | 'delete' | 'login' | 'export' | 'read';

/** 기록 대상 — 개인정보를 담는 컬렉션, 로그인 세션, 반출, 기관 증빙서류 */
export type AuditTargetType = 'driveLog' | 'user' | 'session' | 'export' | 'orgDocument';

/** 행위자를 어떻게 알아냈는지 — 기록의 신뢰 수준을 스스로 구분한다 */
export type AuditActorSource =
    /**
     * 클라이언트가 심은 `lastEditedByUid`. Rules가 `request.auth.uid`와의 일치를
     * 강제하므로 타인 명의로는 위조할 수 없다 — 세 출처 중 신뢰 수준이 가장 높다.
     */
    | 'stamp'
    /**
     * 인증 토큰에서 직접 확인. 콜러블이 `request.auth.uid`로 받으므로 위조 불가하다.
     * (세션 기록 전용 — 트리거는 인증 컨텍스트를 볼 수 없다.)
     */
    | 'auth'
    /** 문서 필드(createdByUid 등)에서 추정 */
    | 'document'
    /** 트리거가 알 수 없음 (서버 쓰기·삭제 등) */
    | 'unknown';

export interface AuditLog extends FirestoreDoc {
    /**
     * 멀티테넌트 필터 — 기관 관리자의 점검 조회에 쓰인다.
     * 기관에 속하지 않는 문서(주로 superAdmin 계정)는 `'__system__'`으로 남긴다.
     * 실재하지 않는 기관 ID라 기관 관리자 조회에는 걸리지 않고 superAdmin만 볼 수 있다.
     */
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
     * driveLog는 대표·공동 운전자, user는 문서 주체 본인.
     *
     * ⚠️ 탑승자(`passengerNames`)는 **일부러 넣지 않는다.** uid 없이 이름만 저장되므로
     * 넣으면 감사 로그가 이름을 담게 되어 최소수집에 반한다. 탑승자 관련 변경은
     * changedFields에 필드명으로만 남긴다.
     */
    subjectUids: string[];
    /**
     * update에서 변경된 필드명 목록. **값은 남기지 않는다.**
     * 값을 남기면 감사 로그가 개인정보 스냅샷이 되어 그 로그도 보호 대상이 된다.
     * 다툼이 되는 것은 "누가 언제 무엇을 고쳤는가"이고 값 자체는 원본 문서에 있다.
     *
     * 화이트리스트(AUDITED_FIELDS)에 든 필드만 들어온다 — 클라이언트가 임의 필드명을
     * 주입해 로그를 오염시키는 경로를 원천 차단하기 위한 것이다.
     */
    changedFields?: string[];
    /**
     * 접속지 IP (고시 제16조의 '접속지 정보') — 로그인 세션 기록에만 있다.
     * 문서 변경 로그는 Firestore 트리거가 남기는데 트리거는 호출자의 IP를 볼 수 없다.
     */
    ip?: string | null;
    /**
     * 접속 환경 — `"Chrome / Android"`처럼 브라우저·OS 수준으로 축약한다.
     * User-Agent 원문은 기기 지문에 가까워져 접속기록 자체가 과잉 수집이 된다.
     */
    userAgent?: string;
    /**
     * 반출 형식·대상·건수 — 반출 기록(`action: 'export'`)에만 있다.
     * **반출된 데이터의 내용도, 검색 조건도 남기지 않는다**(recordExport 주석 참고).
     */
    exportFormat?: string;
    exportDataset?: string;
    recordCount?: number;
    at: TimestampField;
    /** TTL 정책 대상 필드 — at + 1년. 콘솔에서 auditLogs 컬렉션에 TTL을 설정해야 동작한다 */
    expiresAt: TimestampField;
}
