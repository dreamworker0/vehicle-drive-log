import { z } from 'zod';
import { timestampSchema } from './common';

export const orgStatusSchema = z.enum(['pending', 'approved', 'rejected', 'deleted']);
export const withdrawReasonSchema = z.enum(['no_longer_needed', 'too_difficult', 'missing_features', 'other']);

export const organizationSchema = z.object({
    name: z.string().catch(''),
    address: z.string().optional().catch(undefined),
    phone: z.string().optional().catch(undefined),
    representativeName: z.string().optional().catch(undefined),
    adminEmail: z.string().optional().catch(undefined),
    applicantUid: z.string().catch(''),
    applicantEmail: z.string().optional().catch(undefined),
    applicantName: z.string().optional().catch(undefined),
    applicantPhone: z.string().optional().catch(undefined),
    message: z.string().optional().catch(undefined),
    approvalLine: z.array(z.object({ title: z.string().catch('') })).optional().catch(undefined),
    hideApprovalLine: z.boolean().optional().catch(undefined),
    requireReservationApproval: z.boolean().optional().catch(undefined),
    // ── 기능 사용 토글(미설정=켜짐). resolveOrgFeatures로 해석 ──
    /** 하이패스 사용(운행일지 하이패스 입력 + 차량관리 하이패스 탭 + 관리자 하이패스 관리) */
    hipassEnabled: z.boolean().optional().catch(undefined),
    /** 수리·정비 사용(차량관리 정비 탭 + 관리자 정비 기록) */
    maintenanceEnabled: z.boolean().optional().catch(undefined),
    /** 수리·정비를 일반 직원도 사용(미설정=허용). 끄면 관리자만 정비 기록 */
    maintenanceEmployeeAccess: z.boolean().optional().catch(undefined),
    /** 차량별 사용 가능 직원 지정(차량 등록 폼 노출, 미설정=사용) */
    allowedUsersEnabled: z.boolean().optional().catch(undefined),
    /** Google 캘린더 연동(차량 등록 폼 노출, 미설정=사용) */
    googleCalendarEnabled: z.boolean().optional().catch(undefined),
    /** 운행일지 대표 운전자 지정(변경) 사용 */
    driverSelectionEnabled: z.boolean().optional().catch(undefined),
    /** 운행일지 공동 운전자 사용 */
    coDriverEnabled: z.boolean().optional().catch(undefined),
    /** 운행일지 동승자 기록 사용 */
    passengerEnabled: z.boolean().optional().catch(undefined),
    // ── 입력 방식 개별 활성화(미설정=켜짐). 최소 1개는 유지 ──
    /** 동승자: 직원 목록에서 직접 선택 */
    passengerAllowList: z.boolean().optional().catch(undefined),
    /** 동승자: 검색으로 선택(이름 직접 입력) */
    passengerAllowSearch: z.boolean().optional().catch(undefined),
    /** 동승자: 인원 숫자만 입력 */
    passengerAllowCount: z.boolean().optional().catch(undefined),
    /**
     * 예약 화면에서도 동승자를 미리 입력 (미설정=**꺼짐**).
     * 다른 플래그와 반대로 opt-in인 이유는 orgFeatures.ts 주석 참고.
     */
    reservationPassengerEnabled: z.boolean().optional().catch(undefined),
    /** 운전자(대표·공동): 직원 목록에서 직접 선택 */
    driverAllowList: z.boolean().optional().catch(undefined),
    /** 운전자(대표·공동): 검색으로 선택. 목록·검색 둘 다 켜지면 후보 8명 기준 자동 전환 */
    driverAllowSearch: z.boolean().optional().catch(undefined),
    status: orgStatusSchema.catch('pending'),
    inviteCode: z.string().optional().catch(undefined),
    uniqueNumber: z.string().optional().catch(undefined),
    /** @deprecated 레거시 — 토큰 포함 다운로드 URL. 신규 문서는 uniqueNumberImagePath 사용 (2026-07-18 P0-3) */
    uniqueNumberImageUrl: z.string().optional().catch(undefined),
    /** 증빙서류 Storage 경로. 표시용 URL은 getOrgDocumentUrl 콜러블로 온디맨드 발급 */
    uniqueNumberImagePath: z.string().optional().catch(undefined),
    aiVerified: z.boolean().optional().catch(undefined),
    aiVerifyDetail: z.object({
        documentType: z.string().optional().catch(undefined),
        uniqueNumber: z.string().optional().catch(undefined),
        extractedName: z.string().optional().catch(undefined),
        nameMatch: z.boolean().optional().catch(undefined),
        address: z.string().optional().catch(undefined),
        rejected: z.boolean().optional().catch(undefined),
        reason: z.string().optional().catch(undefined),
    }).optional().catch(undefined),
    /**
     * 약관·처리방침 동의 기록 (위탁 계약 성립 근거 — 약관 제9조).
     * 여기서 빠지면 createZodConverter의 fromFirestore가 unknown key를 조용히 제거해
     * (Zod z.object 기본 동작) Firestore에 저장돼 있어도 앱에서는 항상 undefined가 된다.
     * 저장만 되고 조회가 불가능해지므로 입증 자료로 쓸 수 없다.
     */
    consent: z.object({
        terms: z.boolean().catch(false),
        privacy: z.boolean().catch(false),
        termsVersion: z.string().catch(''),
        privacyVersion: z.string().catch(''),
        agreedAt: timestampSchema.optional().catch(undefined),
        source: z.literal('reconsent').optional().catch(undefined),
        agreedByUid: z.string().optional().catch(undefined),
    }).optional().catch(undefined),
    createdAt: timestampSchema.optional().catch(undefined),
    approvedAt: timestampSchema.optional().catch(undefined),
    rejectedAt: timestampSchema.optional().catch(undefined),
    deletedAt: timestampSchema.nullable().optional().catch(null),
    /** 삭제(탈퇴) 주체 — 'admin'은 관리자 자발적 해지, 'superAdmin'은 운영자 정리 */
    deletedBy: z.enum(['admin', 'superAdmin']).optional().catch(undefined),
    /** 자발적 탈퇴 사유 */
    withdrawReason: withdrawReasonSchema.optional().catch(undefined),
    /** 사유가 'other'일 때 자유 입력 상세 */
    withdrawReasonDetail: z.string().optional().catch(undefined),
    firstEmployeeRegisteredAt: timestampSchema.optional().catch(undefined),
    timeToFirstEmployeeDays: z.number().optional().catch(undefined),
    /** 지도 표시용 위도 */
    lat: z.coerce.number().optional().catch(undefined),
    /** 지도 표시용 경도 */
    lng: z.coerce.number().optional().catch(undefined),
});

export type OrganizationSchemaType = z.infer<typeof organizationSchema>;
