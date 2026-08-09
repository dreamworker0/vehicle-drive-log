import { z } from 'zod';
import { timestampSchema } from './common';

export const userRoleSchema = z.enum(['employee', 'admin', 'superAdmin']);

export const userSchema = z.object({
    uid: z.string().optional().catch(''),
    name: z.string().catch('-'),
    email: z.string().catch(''),
    role: userRoleSchema.catch('employee'),
    organizationId: z.string().nullable().catch(null),
    organizationStatus: z.string().optional().catch(''),
    theme: z.enum(['light', 'dark']).optional().catch(undefined),
    status: z.enum(['active', 'disabled']).optional().catch('active'),
    photoURL: z.string().optional().catch(''),
    phone: z.string().optional().catch(''),
    welcomeDismissed: z.boolean().optional().catch(undefined),
    /**
     * 이용약관 동의 기록 (계정 개설·면책 근거)
     *
     * 개인정보 처리방침 동의는 일부러 받지 않는다. 직원 개인정보의 처리 근거는
     * 동의가 아니라 기관의 업무 수행(개인정보 보호법 제15조 제1항 2·4호)이며,
     * 동의를 근거로 삼으면 직원이 동의를 철회하는 순간 운행일지를 쓸 수 없게 된다.
     * 또한 수탁자 구조에서 정보주체 고지·동의 책임은 위탁자인 기관에 있으므로,
     * 서비스가 직원에게 직접 개인정보 동의를 받는 것은 처리자처럼 행동한 증거가 된다.
     *
     * joinOrganization(Admin SDK)만 기록하며 Rules가 클라이언트 변경을 차단한다.
     * 개정 약관 시행일(TERMS_VERSION) 이전에 가입한 직원에게는 없다 — ConsentGate가 재동의로 채운다.
     * 스키마에서 빠지면 createZodConverter가 unknown key를 조용히 제거해
     * 앱에서 항상 undefined가 되므로 반드시 함께 유지한다.
     */
    consent: z.object({
        terms: z.boolean().catch(false),
        termsVersion: z.string().catch(''),
        agreedAt: timestampSchema.optional().catch(undefined),
    }).optional().catch(undefined),
    /**
     * 마지막 수정자 uid — 접속기록의 '계정' 항목 (고시 제16조).
     *
     * 권한(role)·상태(status) 변경은 고시 제5조가 별도로 요구하는 기록 대상인데,
     * 트리거가 호출자를 알 수 없어 "누가 권한을 올렸는가"가 공백이었다(Phase 123).
     * Rules가 `request.auth.uid`와의 일치를 강제하므로 타인 명의 위조는 불가능하다.
     *
     * ⚠️ 삭제 행위자에는 쓸 수 없다 — 남은 값은 마지막 '수정자'이지 '삭제자'가 아니다.
     */
    lastEditedByUid: z.string().optional().catch(undefined),
    /** FCM 푸시 토큰 — useNotification이 심고 알림 발송 함수가 읽는다 */
    fcmToken: z.string().optional().catch(undefined),
    createdAt: timestampSchema.optional().catch(undefined),
    disabledAt: timestampSchema.optional().catch(undefined),
    promotedAt: timestampSchema.optional().catch(undefined),
});

export type UserSchemaType = z.infer<typeof userSchema>;
