---
name: add-alimtalk
description: 카카오 알림톡 등 외부 알리미 발송 템플릿과 로직을 추가하는 패턴 가이드
---
# 카카오 알림톡 추가 가이드 (add-alimtalk)

차량운행일지 앱 내에서 예약 알림, 승인 요청, 미활동 알림 등 **외부 채널 타겟 메시지**를 구성할 때 참고하는 스킬 가이드입니다.

## 1. 페이로드 (Payload) 표준 패턴
카카오 알림톡 등 외부 API를 호출할 때는 환경에 따라 형식이 다를 수 있으므로, 재사용 가능한 빌더 모듈을 작성해야 합니다.
```typescript
interface AlimtalkPayload {
  templateCode: string;
  recipient: string; // E.164 형식 권장 (+82)
  variables: Record<string, string>;
}

export const buildReservationAlimtalk = (data: YourDataType): AlimtalkPayload => {
  return {
    templateCode: "RESERVATION_CONFIRM_01",
    recipient: data.phoneNumber,
    variables: {
      "차량명": data.vehicleName,
      "날짜": data.date,
    }
  };
};
```

## 2. 보안 유의사항
- **API Key 노출 금지**: 알림톡 제공사의 Secret이나 API Token은 하드코딩하지 않습니다. `functions/` 에서는 `defineSecret` 혹은 Firebase Secret Manager를 사용하여 가져옵니다.

## 3. 에러 로깅 및 재도전 룰
- 중요 알림은 발송 실패 이력이Firestore나 별도 컬렉션(`notification_logs`)에 기록되어야 관리자가 원인을 추적할 수 있습니다.
- 발송 실패 시 (예: 휴대폰 번호 불량) 사용자 상태를 '알림 불가' 로 변경하거나 예외 리포트에 남겨야 재시도 폭탄을 방지합니다.
