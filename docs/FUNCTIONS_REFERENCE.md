# Cloud Functions 레퍼런스

> **자동 생성 문서** — `scripts/generate-functions-doc.ts`로 생성됨  
> 마지막 업데이트: 2026. 7. 18. AM 10:04:23  
> 총 함수 수: **47개**

---

## 목차

- [📞 onCall (클라이언트 직접 호출)](#oncall)
- [🌐 onRequest (HTTP 요청)](#onrequest)
- [⏰ onSchedule (스케줄)](#onschedule)
- [📝 Firestore onCreate](#ondocumentcreated)
- [✏️ Firestore onWrite](#ondocumentwritten)
- [🗑️ Firestore onDelete](#ondocumentdeleted)
- [👤 Auth 트리거](#onuserdeleted)

---

## 📞 onCall (클라이언트 직접 호출)

> 총 24개

### `ocrDashboard`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/ocrDashboard.ts` |
| **설명** | 계기판 사진을 Gemini Vision API로 분석하여 현재 주행거리(km)와 배터리%(EV) 추출 |
| **인증** | 기관 멤버 (인증 필수) |
| **요청 파라미터** | `{ imageBase64: string, mimeType: string }` |
| **반환값** | `{ km: number | null, batteryPercent: number | null }` |

### `ocrDocument`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/ocrDocument.ts` |
| **설명** | 사업자등록증/고유번호증 이미지를 OCR하여 기관명, 사업자번호, 주소 추출 |
| **인증** | 인증 필수 |
| **요청 파라미터** | `{ imageBase64: string, mimeType: string }` |
| **반환값** | `{ orgName: string, bizNumber: string, address: string }` |

### `getOrgDocumentUrl`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/getOrgDocumentUrl.ts` |
| **설명** | 기관 증빙서류의 5분 만료 서명 URL 발급 (심사 화면 표시용). 증빙서류는 영구 다운로드 토큰 없이 경로만 저장되므로 표시 시점마다 온디맨드 발급한다. |
| **인증** | superAdmin 전용 |
| **요청 파라미터** | `{ orgId: string }` |
| **반환값** | `{ url: string }` |

### `createReservationSafe`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/createReservationSafe.ts` |
| **설명** | Firestore Transaction으로 예약 중복을 방지하며 안전하게 예약 생성 |
| **인증** | 인증된 기관 멤버 |
| **요청 파라미터** | `{ organizationId, vehicleId, vehicleName, date, startTime, endTime, purpose, destination, reservedByUid, reservedByName }` |
| **반환값** | `{ success: boolean, reservationId: string }` |

### `joinOrganization`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/joinOrganization.ts` |
| **설명** | 초대 코드로 기관에 가입. 신규 사용자가 Custom Claims 미보유 시에도 정상 처리. |
| **인증** | 인증 필수 |
| **요청 파라미터** | `{ inviteCode: string }` |
| **반환값** | `{ success: boolean, organizationId: string }` |

### `disableUser`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/disableUser.ts` |
| **설명** | Firebase Auth 비활성화 + Firestore 사용자 문서 삭제 (직원 제거) |
| **인증** | 기관 관리자 이상 (manager/superAdmin) |
| **요청 파라미터** | `{ uid: string }` |
| **반환값** | `{ success: boolean }` |

### `restoreUser`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/restoreUser.ts` |
| **설명** | 비활성화된 계정을 Auth 재활성화 + Firestore 문서 복원 |
| **인증** | 기관 관리자 이상 |
| **요청 파라미터** | `{ uid: string }` |
| **반환값** | `{ success: boolean }` |

### `sendAdminNotice`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/sendAdminNotice.ts` |
| **설명** | 관리자가 기관 전체 직원에게 알림을 발송 |
| **인증** | 기관 관리자 이상 |
| **요청 파라미터** | `{ organizationId: string, title: string, message: string }` |

### `refreshDashboardStats`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/caching/refreshDashboardStats.ts` |
| **설명** | SuperAdmin 대시보드 통계 수동 갱신 (즉시 재계산) |
| **인증** | superAdmin |
| **반환값** | `{ success: boolean }` |

### `recalculateAggregatedStats`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/caching/recalculateAggregatedStats.ts` |
| **설명** | 집계 통계 일괄 재계산. 마이그레이션/데이터 보정 시 사용. |
| **인증** | superAdmin |

### `cleanupDuplicateLogs`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/cleanupDuplicateLogs.ts` |
| **설명** | 중복된 운행일지 탐지 및 일괄 정리 (관리자용) |
| **인증** | 기관 관리자 이상 |

### `resetCalendarSyncFails`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/scripts/resetCalendarSyncFails.ts` |
| **설명** | 캘린더 동기화 실패 카운터 초기화 |
| **인증** | superAdmin |

### `testCalendarAccess`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/testCalendarAccess.ts` |
| **설명** | Google Calendar API 접근 가능 여부 테스트 (관리자 진단용) |
| **인증** | 기관 관리자 이상 |

### `sendManualApprovalAlimtalk`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/sendManualApprovalAlimtalk.ts` |
| **설명** | 수동 승인 시 신청자에게 카카오 알림톡 발송 |
| **인증** | superAdmin |

### `sendApprovalEmail`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/sendApprovalEmail.ts` |
| **설명** | 기관 승인 이메일 서버사이드 발송 |
| **인증** | superAdmin |

### `sendRejectionEmail`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/sendRejectionEmail.ts` |
| **설명** | 기관 거절 이메일 서버사이드 발송 |
| **인증** | superAdmin |

### `regenerateFeedbackDraft`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/regenerateFeedbackDraft.ts` |
| **설명** | AI 피드백 답변 초안 수동 재생성 (관리자 호출) |
| **인증** | superAdmin |

### `sendFeedbackReply`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/sendFeedbackReply.ts` |
| **설명** | 슈퍼관리자가 피드백 답변 발송. 이메일 또는 알림톡으로 사용자에게 전달. |
| **인증** | superAdmin |
| **요청 파라미터** | `{ feedbackId: string, reply: string }` |

### `askAI`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/askAI.ts` |
| **설명** | FAQ 기반 Gemini AI 답변 (앱 내 "AI에게 물어보기" 기능) |
| **인증** | 인증 필수 |
| **요청 파라미터** | `{ question: string }` |
| **반환값** | `{ answer: string, faqId: string | null, confidence: number }` |

### `apiHealthCheck`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/apiHealthCheck.ts` |
| **설명** | 외부 API(Tmap, Gemini, EmailJS, Discord) 및 Firestore 연결 상태 종합 점검 |
| **인증** | superAdmin |
| **반환값** | `{ status: "ok" | "degraded", services: Record<string, boolean> }` |

### `sendBulkReminder`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/index.ts (inline)` |
| **설명** | 미활성 기관(직원 0명)에게 알림톡 일괄 발송 |
| **인증** | superAdmin |
| **반환값** | `{ sentCount, failCount, noPhoneCount, results }` |

### `submitOrgApplication`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/submitOrgApplication.ts` |
| **설명** | 익명(비로그인) 사용자가 기관 신청서를 제출하는 엔드포인트 |
| **인증** | 없음 (공개 — App Check 보호) |

### `submitPublicFeedback`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/submitPublicFeedback.ts` |
| **설명** | 랜딩 페이지 비로그인 방문자 문의 접수 |
| **인증** | 없음 (공개 — App Check 보호) |

### `backfillOrgCoords`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/backfillOrgCoords.ts` |
| **설명** | 기존 기관에 좌표(lat/lng) 추가 (일회성 마이그레이션) |
| **인증** | superAdmin |

---

## 🌐 onRequest (HTTP 요청)

> 총 2개

### `tmapProxy`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/tmapProxy.ts` |
| **설명** | 클라이언트에서 Tmap API를 CORS 없이 호출하기 위한 서버사이드 프록시 |
| **인증** | IP 기반 Rate Limit (분당 60회) |
| **요청 파라미터** | `query params: endpoint, keyword 등 (Tmap API 파라미터)` |

### `holidayProxy`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/holidayProxy.ts` |
| **설명** | 공공데이터포털 공휴일 API 프록시. API 키를 서버에서 관리. |
| **인증** | 없음 (공개 API) |

---

## ⏰ onSchedule (스케줄)

> 총 10개

### `reservationReminder`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/reservationReminder.ts` |
| **설명** | 15분마다 예약 알림(D-1, 당일) 및 미작성 운행일지 알림 발송. 주말 자동 스킵. |
| **인증** | 시스템 자동 실행 |
| **비고** | schedule: "every 15 minutes" (Asia/Seoul), 주말 스킵 |

### `monthlyBatch`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/monthlyBatch.ts` |
| **설명** | 통합 월배치: 공휴일 동기화(syncHolidays) + 차량 마일리지 불일치 검증(verifyMileageConsistency) |
| **인증** | 시스템 자동 실행 |
| **비고** | schedule: "0 6 1 * *" (매월 1일 오전 6시) |

### `syncCalendarToApp`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/calendarSchedule.ts` |
| **설명** | Google Calendar → App 역방향 동기화. 외부에서 캘린더 이벤트 변경 시 App DB에 반영. |
| **인증** | 시스템 자동 실행 |
| **비고** | schedule: "every 2 hours" |

### `backupFirestore`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/backupFirestore.ts` |
| **설명** | Firestore 전체 데이터를 Cloud Storage에 자동 백업 |
| **인증** | 시스템 자동 실행 |

### `autoPurgeOrgs`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/autoPurgeOrgs.ts` |
| **설명** | 일정 기간 미사용 기관 자동 정리 (퍼지) |
| **인증** | 시스템 자동 실행 |

### `archiveDriveLogs`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/archiveDriveLogs.ts` |
| **설명** | 오래된 운행일지를 아카이브 컬렉션으로 이동하여 DB 비용 절감 |
| **인증** | 시스템 자동 실행 |

### `sendInactiveOrgAlimtalkScheduled`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/sendInactiveOrgAlimtalkScheduled.ts` |
| **설명** | 매주 월~금 14시 미활성 기관 점검 및 주 1회 알림톡 발송 |
| **인증** | 시스템 자동 실행 |

### `scheduledDiscordBriefing`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/discordScheduler.ts` |
| **설명** | 정기 Discord 브리핑 및 미활성 기관 알림 |
| **인증** | 시스템 자동 실행 |

### `verifyMileageConsistency`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/scheduler/verifyMileageConsistency.ts` |
| **설명** | 매월 1일 차량 누적 주행거리 오차 검증 |
| **인증** | 시스템 자동 실행 |

### `cleanupCertificateImages`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/cleanupCertificateImages.ts` |
| **설명** | 처리 완료된 기관 신청 증명서 이미지를 Storage에서 정리 |
| **인증** | 시스템 자동 실행 |

---

## 📝 Firestore onCreate

> 총 3개

### `generateFeedbackDraft`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/generateFeedbackDraft.ts` |
| **설명** | feedbacks/{feedbackId} 생성 시 Gemini API로 FAQ 매칭 + AI 답변 초안 자동 생성 |
| **인증** | 시스템 자동 실행 (Firestore 트리거) |

### `onReservationCreated`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/reservationTriggers.ts` |
| **설명** | 예약 생성 시 Google Calendar 이벤트 생성 + 푸시 알림 발송 |
| **인증** | 시스템 자동 실행 |

### `trackFirstEmployee`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/trackFirstEmployee.ts` |
| **설명** | 기관 첫 번째 직원 등록 시점을 Firestore에 기록 |
| **인증** | 시스템 자동 실행 |

---

## ✏️ Firestore onWrite

> 총 6개

### `autoVerifyDocument`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/autoVerifyDocument.ts` |
| **설명** | organizations/{orgId} 문서에 증빙서류(uniqueNumberImagePath, 레거시 uniqueNumberImageUrl)가 추가되면 Gemini OCR + 비영리 판별 → 자동 승인/거절 처리 및 이메일 발송 |
| **인증** | 시스템 자동 실행 (Firestore 트리거) |
| **비고** | 화이트리스트 기관은 즉시 승인. 종교/학교/병원/영리 사업자는 자동 거절. |

### `setCustomClaims`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/setCustomClaims.ts` |
| **설명** | users/{uid} 문서 변경 시 Firebase Auth Custom Claims (role, orgId) 자동 동기화 |
| **인증** | 시스템 자동 실행 (Firestore 트리거) |

### `notifyNewApplication`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/notifyNewApplication.ts` |
| **설명** | 기관 신청(pending)/승인(approved)/거절(rejected) 상태 변화 시 이메일 및 Discord 알림 발송 |
| **인증** | 시스템 자동 실행 (Firestore 트리거) |

### `onReservationUpdated`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/reservationTriggers.ts` |
| **설명** | 예약 수정 시 Google Calendar 이벤트 업데이트 |
| **인증** | 시스템 자동 실행 |

### `updateAggregatedStats`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/caching/updateAggregatedStats.ts` |
| **설명** | 운행일지 생성/수정/삭제 시 기관별 집계 통계 실시간 업데이트 |
| **인증** | 시스템 자동 실행 |

### `notifyRoleChange`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/notifyRoleChange.ts` |
| **설명** | 사용자 권한(role) 변경 감지 시 Discord 보안 알림 발송 |
| **인증** | 시스템 자동 실행 |

---

## 🗑️ Firestore onDelete

> 총 1개

### `onReservationDeleted`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/reservationTriggers.ts` |
| **설명** | 예약 삭제 시 Google Calendar 이벤트 삭제 |
| **인증** | 시스템 자동 실행 |

---

## 👤 Auth 트리거

> 총 1개

### `onUserDelete`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/onUserDelete.ts` |
| **설명** | Firebase Auth 계정 삭제 시 Firestore 개인정보 익명화 처리 |
| **인증** | 시스템 자동 실행 (Auth 트리거) |

---

## 업데이트 방법

새 함수를 추가하거나 변경했을 때:

```bash
npx ts-node scripts/generate-functions-doc.ts
```

또는 `scripts/generate-functions-doc.ts`의 `FUNCTIONS` 배열에 항목을 추가 후 실행.
