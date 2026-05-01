---
name: 이메일 알림 추가 패턴 (add-email-notification)
description: EmailJS 또는 Nodemailer를 이용해 Cloud Functions에서 이메일을 발송하는 기능 추가 가이드.
---

# 이메일 알림 추가 패턴

차량운행일지 시스템에서는 기관 가입 승인/거절 통보, 관리자 피드백 응답 등에서 이메일 발송 기능을 활용합니다. 이메일 전송 로직을 추가할 때 이 패턴을 준수합니다.

## 1. 라이브러리 선택 기준

- **EmailJS (`@emailjs/nodejs`)**: 템플릿 관리가 외부 UI에서 필요하거나 클라이언트 측 로직과 유사한 연동이 필요할 때 사용 (예: 기관 신청 승인/거절).
- **Nodemailer (`nodemailer`)**: 단순 텍스트 기반 이메일, 첨부파일 포함 전송, GMail SMTP 등 백엔드 주도적인 이메일 발송이 필요할 때 사용.

## 2. 구현 패턴

### 2.1 EmailJS 패턴 (`sendRejectionEmail.ts` 등 참조)
```typescript
import emailjs from '@emailjs/nodejs';

const serviceId = process.env.EMAILJS_SERVICE_ID!;
const templateId = process.env.EMAILJS_REJECTION_TEMPLATE_ID!;
const publicKey = process.env.EMAILJS_PUBLIC_KEY!;
const privateKey = process.env.EMAILJS_PRIVATE_KEY!;

// 이메일 발송
await emailjs.send(
    serviceId,
    templateId,
    {
        user_name: '사용자명',
        user_email: 'target@example.com',
        rejection_reason: '반려 사유 내용'
    },
    {
        publicKey,
        privateKey,
    }
);
```

### 2.2 Nodemailer 패턴
```typescript
import * as nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS, // 앱 비밀번호
    },
});

await transporter.sendMail({
    from: '"차량운행일지" <noreply@example.com>',
    to: 'target@example.com',
    subject: '이메일 제목',
    text: '텍스트 본문',
    html: '<b>HTML 본문</b>',
});
```

## 3. 환경변수 등록

이메일 연동은 무조건 민감 키(Secret)를 사용하므로 로컬 `.env` 파일과 Cloud Functions 배포 환경 변수에 모두 키를 설정해야 합니다.
- **예시**: `EMAILJS_SERVICE_ID`, `SMTP_PASS` 등
- GitHub 배포를 위해 Repository Secrets에도 등록되었는지 확인하세요.

## 4. 에러 핸들링

이메일 전송 실패가 비즈니스 로직(예: Firestore 데이터 상태 변경) 전체의 실패로 이어지지 않게 하려면, 비동기 호출(`await emailjs.send`)을 try-catch로 감싸 로그만 남기고 정상 종료시키는 방식을 고려합니다. (성공 여부가 Critical Flow인 경우 제외)
