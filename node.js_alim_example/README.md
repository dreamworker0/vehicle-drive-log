# 알림톡 연동 예시 & 프록시

차량운행일지 앱에서 카카오 알림톡(알리고 API)을 발송하기 위한 참고 파일 모음입니다.

## 구성 파일

| 파일 | 용도 |
|------|------|
| `send_alimtalk_vehicle_drive_log_proxy.php` | **프로덕션 프록시** — Cafe24에 배포하여 Cloud Functions → 알리고 API 중계. `X-API-Token` 헤더로 인증 |
| `test_alimtalk.php` | 알림톡 발송 테스트용 PHP (알리고 SDK 직접 호출) |
| `curl_send_alimtalk_universal.php` | curl 기반 범용 알림톡 발송 예시 |
| `examples/` | 알리고 공식 Node.js SDK 예시 |
| `aligo_api_brand_nodejs.zip` | 알리고 공식 브랜드톡 Node.js SDK 원본 |

## 프로덕션 흐름

```
Cloud Functions (sendAlimtalk.ts)
  → HTTP POST → Cafe24 PHP 프록시 (send_alimtalk_vehicle_drive_log_proxy.php)
    → 알리고 API (카카오 알림톡 발송)
```

## 사용 중인 템플릿

| 코드 | 용도 |
|------|------|
| `TY_4858` | 기관 승인 알림 (서비스 링크 + 초대 코드) |
| `UG_2597` | 미활성 기관 리마인드 (관리자 등록 안내) |

## 환경변수 (functions/.env)

```
ALIMTALK_PROXY_URL=https://[cafe24도메인]/send_alimtalk_vehicle_drive_log_proxy.php
ALIMTALK_PROXY_TOKEN=[인증 토큰]
```

## 참고 링크

- 알리고 API 안내: https://smartsms.aligo.in/smsapi.html
- 알리고 고객센터: https://smartsms.aligo.in/qna/help_quest.html