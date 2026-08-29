---
name: add-email-notification
description: EmailJS 또는 Nodemailer를 이용해 Cloud Functions에서 이메일을 발송하는 기능 추가 가이드.
---

# 이메일 알림 추가 패턴

차량운행일지 시스템에서는 기관 가입 승인/거절 통보, 관리자 피드백 응답 등에서 이메일 발송 기능을 활용합니다. 이메일 전송 로직을 추가할 때 이 패턴을 준수합니다.

## 1. 라이브러리 선택 기준

- **Nodemailer + Gmail (기본)**: 새 이메일 발송은 이쪽이다. **직접 `nodemailer.createTransport`를 쓰지 않고** 공용 헬퍼 `createGmailTransporter()`(`functions/src/core/mailer.ts`)를 재사용한다 — 과거 같은 복붙이 5곳에 흩어져 있던 것을 단일화한 것이다.
- **EmailJS (`@emailjs/nodejs`)**: 기존 사용처는 기관 자동 검증 승인 메일(`functions/src/services/driveLog/verifyHelpers.ts`) 한 곳뿐이다. 외부 UI에서 관리되는 템플릿이 꼭 필요할 때만 고려한다.

## 2. 구현 패턴

### 2.1 Gmail 패턴 (기본 — `sendRejectionEmail.ts`, `sendFeedbackReply.ts` 등 참조)
```typescript
import { createGmailTransporter, isGmailConfigured, systemMailFrom } from "../../core/mailer";

if (isGmailConfigured()) {
    const transporter = createGmailTransporter();
    await transporter.sendMail({
        from: systemMailFrom(),           // "차량운행일지 시스템" <GMAIL_USER>
        to: 'target@example.com',
        subject: '이메일 제목',
        text: '텍스트 본문',
        html: '<b>HTML 본문</b>',
    });
}
```

### 2.2 EmailJS 패턴 (`verifyHelpers.ts` 참조)
`EMAILJS_PRIVATE_KEY`는 `defineSecret`(`functions/src/core/params.ts`)으로 주입된다. 새 EmailJS 사용처를 추가하려면 verifyHelpers.ts의 `emailjs.send` 호출을 본뜬다.

## 3. 환경변수 등록

이메일 연동은 무조건 민감 키(Secret)를 사용하므로 로컬 `functions/.env`와 배포 환경 양쪽에 키를 설정해야 합니다.
- **Gmail**: `GMAIL_USER`, `GMAIL_APP_PASSWORD` (앱 비밀번호)
- **EmailJS**: `EMAILJS_PRIVATE_KEY` (Secret Manager, `defineSecret`)
- GitHub 배포를 위해 Repository Secrets에도 등록되었는지 확인하세요.

## 4. 에러 핸들링

이메일 전송 실패가 비즈니스 로직(예: Firestore 데이터 상태 변경) 전체의 실패로 이어지지 않게 하려면, 비동기 호출(`await emailjs.send`)을 try-catch로 감싸 로그만 남기고 정상 종료시키는 방식을 고려합니다. (성공 여부가 Critical Flow인 경우 제외)
