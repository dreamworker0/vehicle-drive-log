# Cloud Functions 레퍼런스

> **자동 생성 문서** — `scripts/generate-functions-doc.ts`로 생성됨
>
> 마지막 업데이트: 2026. 8. 2. AM 8:02:47
>
> 총 함수 수: **67개**

---

## 목차

- [📞 onCall (클라이언트 직접 호출)](#oncall)
- [🌐 onRequest (HTTP 요청)](#onrequest)
- [⏰ onSchedule (스케줄)](#onschedule)
- [📝 Firestore onCreate](#ondocumentcreated)
- [✏️ Firestore onWrite](#ondocumentwritten)
- [🔄 Firestore onUpdate](#ondocumentupdated)
- [🗑️ Firestore onDelete](#ondocumentdeleted)
- [👤 Auth 트리거](#onuserdeleted)

---

## 📞 onCall (클라이언트 직접 호출)

> 총 38개

### `ocrDashboard`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/handlers/callable/ocrDashboard.ts` |
| **설명** | 계기판 사진을 Gemini Vision API로 분석하여 현재 주행거리(km)와 배터리%(EV) 추출 |
| **인증** | 기관 멤버 (인증 필수) |
| **요청 파라미터** | `{ imageBase64: string, mimeType: string }` |
| **반환값** | `{ km: number | null, batteryPercent: number | null }` |

### `ocrDocument`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/handlers/callable/ocrDocument.ts` |
| **설명** | 사업자등록증/고유번호증 이미지를 OCR하여 기관명, 사업자번호, 주소 추출 |
| **인증** | 인증 필수 |
| **요청 파라미터** | `{ imageBase64: string, mimeType: string }` |
| **반환값** | `{ orgName: string, bizNumber: string, address: string }` |

### `getOrgDocumentUrl`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/handlers/callable/getOrgDocumentUrl.ts` |
| **설명** | 기관 증빙서류의 5분 만료 서명 URL 발급 (심사 화면 표시용). 증빙서류는 영구 다운로드 토큰 없이 경로만 저장되므로 표시 시점마다 온디맨드 발급한다. |
| **인증** | superAdmin 전용 |
| **요청 파라미터** | `{ orgId: string }` |
| **반환값** | `{ url: string }` |

### `createReservationSafe`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/handlers/callable/createReservationSafe.ts` |
| **설명** | Firestore Transaction으로 예약 중복을 방지하며 안전하게 예약 생성 |
| **인증** | 인증된 기관 멤버 |
| **요청 파라미터** | `{ organizationId, vehicleId, vehicleName, date, startTime, endTime, purpose, destination, reservedByUid, reservedByName }` |
| **반환값** | `{ success: boolean, reservationId: string }` |

### `triggerOnDemandCalendarSync`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/handlers/callable/triggerOnDemandCalendarSync.ts` |
| **설명** | 예약 화면 진입 시 해당 차량만 구글 캘린더 역동기화 (30분 스케줄을 기다리지 않고 즉시 반영) |
| **인증** | 인증된 기관 멤버 |
| **요청 파라미터** | `{ vehicleId?: string, organizationId?: string }` |
| **비고** | 동기화 실패가 누적된 차량(MAX_FAIL_COUNT 초과)은 스킵 |

### `testCalendarAccess`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/handlers/callable/testCalendarAccess.ts` |
| **설명** | Google Calendar API 접근 가능 여부 테스트 (관리자 진단용) |
| **인증** | 기관 관리자 이상 |

### `resetCalendarSyncFails`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/scripts/resetCalendarSyncFails.ts` |
| **설명** | 캘린더 동기화 실패 카운터 초기화 |
| **인증** | superAdmin |

### `joinOrganization`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/handlers/callable/joinOrganization.ts` |
| **설명** | 초대 코드로 기관에 가입. 신규 사용자가 Custom Claims 미보유 시에도 정상 처리. 이용약관 동의를 함께 기록한다(개인정보 동의는 받지 않음 — 처리 근거가 기관의 업무 수행이므로). `termsVersion`은 `YYYY-MM-DD` 형식. |
| **인증** | 인증 필수 (익명 로그인 차단) |
| **요청 파라미터** | `{ code: string, agreedTerms: true, termsVersion: string }` |
| **반환값** | `{ success: boolean, orgId: string, orgName: string, role: 'admin' \| 'employee' }` |

### `acceptCurrentTerms`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/handlers/callable/acceptCurrentTerms.ts` |
| **설명** | 개정 약관·처리방침 재동의 기록. 동의 기록은 Rules가 클라이언트 쓰기를 차단하므로 이 함수만 기록한다. 기관 관리자는 기관 위탁 동의(`organizations.consent`)와 본인 약관 동의(`users.consent`)를 함께, 직원은 본인 약관 동의만 기록. 관리자는 `agreedPrivacy`·`privacyVersion`이 필수. |
| **인증** | 인증 필수 |
| **요청 파라미터** | `{ agreedTerms: true, termsVersion: string, agreedPrivacy?: true, privacyVersion?: string }` |
| **반환값** | `{ success: boolean, orgRecorded: boolean }` |

### `recordSession`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/handlers/callable/recordSession.ts` |
| **설명** | 로그인 세션 기록 — 고시 제16조의 접속지(IP)·계정·일시를 남긴다. 트리거는 IP를 볼 수 없어 콜러블로 받는다. `sessionId`는 브라우저 세션당 난수 1개이며 문서 ID에 쓰여 같은 세션의 재호출이 중복을 만들지 않는다. User-Agent는 브라우저/OS 수준으로 축약해 저장한다. |
| **인증** | 인증 필수 |
| **요청 파라미터** | `{ sessionId: string }` |
| **반환값** | `{ success: boolean }` |

### `recordExport`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/handlers/callable/recordExport.ts` |
| **설명** | 개인정보 반출(엑셀·PDF 내보내기) 기록 — 고시 제16조. 형식·대상·건수만 남기고 **반출된 데이터 내용과 검색 조건은 담지 않는다**. `format`·`dataset`은 화이트리스트로 제한해 임의 값 주입을 막는다. 브라우저에서 파일을 만들므로 클라이언트가 부르지 않으면 남지 않는 한계가 있다. |
| **인증** | 인증 필수 |
| **요청 파라미터** | `{ format: 'excel' \| 'pdf', dataset: string, recordCount: number, exportId: string }` |
| **반환값** | `{ success: boolean }` |

### `sendBroadcastNotice`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/handlers/callable/sendBroadcastNotice.ts` |
| **설명** | 전체 기관의 관리자·직원에게 앱 내 알림 + 푸시를 일괄 발송. `sendAdminNotice`가 자기 기관 한정이라 서비스 전역 고지(약관 개정 등) 경로가 없어 신설. `dryRun: true`면 **대상 수만 반환하고 아무것도 보내지 않는다** — 화면이 이 값을 확인시킨 뒤에만 실제 발송한다. `noticeId`로 문서 ID를 고정해 재클릭·재시도가 알림을 중복 생성하지 않는다. 비활성 계정과 기관 미소속 계정은 제외. |
| **인증** | 시스템 관리자(superAdmin) 전용 |
| **요청 파라미터** | `{ title: string, message: string, noticeId: string, dryRun?: boolean }` |
| **반환값** | `{ success: boolean, dryRun: boolean, recipientCount: number, pushSent?: number, pushFailed?: number }` |

### `disableUser`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/handlers/callable/disableUser.ts` |
| **설명** | Firebase Auth 비활성화 + Firestore 사용자 문서 삭제 (직원 제거) |
| **인증** | 기관 관리자 이상 (admin/superAdmin) |
| **요청 파라미터** | `{ uid: string }` |
| **반환값** | `{ success: boolean }` |

### `restoreUser`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/handlers/callable/restoreUser.ts` |
| **설명** | 비활성화된 계정을 Auth 재활성화 + Firestore 문서 복원 |
| **인증** | 기관 관리자 이상 |
| **요청 파라미터** | `{ uid: string }` |
| **반환값** | `{ success: boolean }` |

### `deleteUserPermanently`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/handlers/callable/deleteUserPermanently.ts` |
| **설명** | 비활성(disabled) 직원의 users 문서 + 즐겨찾기 + Auth 계정을 영구 삭제. 운행일지·주유기록 등 기관 기록은 driverName이 비정규화되어 보존된다. |
| **인증** | 기관 관리자 (같은 기관, disabled 상태 직원만) |
| **요청 파라미터** | `{ uid: string }` |

### `withdrawOrganization`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/handlers/callable/withdrawOrganization.ts` |
| **설명** | 기관 자발적 서비스 해지. 소속 직원 user 문서를 일괄 삭제하고 기관을 soft delete(30일 복구 가능) 처리하며 해지 사유를 기록한다. |
| **인증** | 기관 관리자 (자기 기관만) |
| **요청 파라미터** | `{ organizationId: string, reason: string, reasonDetail?: string }` |

### `sendAdminNotice`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/handlers/callable/sendAdminNotice.ts` |
| **설명** | 관리자가 기관 전체 직원에게 알림을 발송 |
| **인증** | 기관 관리자 이상 |
| **요청 파라미터** | `{ organizationId: string, title: string, message: string }` |

### `sendApprovalEmail`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/handlers/callable/sendApprovalEmail.ts` |
| **설명** | 기관 승인 이메일 서버사이드 발송 |
| **인증** | superAdmin |

### `sendRejectionEmail`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/handlers/callable/sendRejectionEmail.ts` |
| **설명** | 기관 거절 이메일 서버사이드 발송 |
| **인증** | superAdmin |

### `sendManualApprovalAlimtalk`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/handlers/callable/sendManualApprovalAlimtalk.ts` |
| **설명** | 수동 승인 시 신청자에게 카카오 알림톡 발송 |
| **인증** | superAdmin |

### `sendManualRejectionAlimtalk`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/handlers/callable/sendManualRejectionAlimtalk.ts` |
| **설명** | 기관 신청 반려 시 신청자에게 카카오 알림톡 발송 (반려 이메일과 병행 호출) |
| **인증** | superAdmin |
| **요청 파라미터** | `{ orgId: string, reason?: string }` |

### `sendBulkReminder`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/handlers/callable/sendBulkReminder.ts` |
| **설명** | 미활성 기관(직원 0명)에게 알림톡 일괄 발송 |
| **인증** | superAdmin |
| **반환값** | `{ sentCount, failCount, noPhoneCount, results }` |

### `regenerateFeedbackDraft`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/handlers/callable/regenerateFeedbackDraft.ts` |
| **설명** | AI 피드백 답변 초안 수동 재생성 (관리자 호출) |
| **인증** | superAdmin |

### `sendFeedbackReply`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/handlers/callable/sendFeedbackReply.ts` |
| **설명** | 슈퍼관리자가 피드백 답변 발송. 이메일 또는 알림톡으로 사용자에게 전달. |
| **인증** | superAdmin |
| **요청 파라미터** | `{ feedbackId: string, reply: string }` |

### `askAI`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/handlers/callable/askAI.ts` |
| **설명** | FAQ·매뉴얼 기반 Gemini AI 답변 (앱 내 "AI에게 물어보기" 기능) |
| **인증** | 인증 필수 |
| **요청 파라미터** | `{ question: string }` |
| **반환값** | `{ answer: string, faqId: string | null, confidence: number }` |

### `refreshDashboardStats`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/handlers/callable/refreshDashboardStats.ts` |
| **설명** | SuperAdmin 대시보드 통계 수동 갱신 (즉시 재계산) |
| **인증** | superAdmin |
| **반환값** | `{ success: boolean }` |

### `recalculateAggregatedStats`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/handlers/callable/recalculateAggregatedStats.ts` |
| **설명** | 집계 통계 일괄 재계산. 마이그레이션/데이터 보정 시 사용. |
| **인증** | superAdmin |

### `cleanupDuplicateLogs`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/handlers/callable/cleanupDuplicateLogs.ts` |
| **설명** | 중복된 운행일지 탐지 및 일괄 정리 (관리자용) |
| **인증** | 기관 관리자 이상 |

### `apiHealthCheck`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/handlers/https/apiHealthCheck.ts` |
| **설명** | 외부 API(Tmap, Gemini, 이메일, Discord) 및 Firestore·스케줄러 하트비트 종합 점검 |
| **인증** | superAdmin |
| **반환값** | `{ status: "ok" | "degraded", services: Record<string, boolean> }` |

### `submitOrgApplication`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/handlers/https/submitOrgApplication.ts` |
| **설명** | 익명(비로그인) 사용자가 기관 신청서를 제출하는 엔드포인트 |
| **인증** | 없음 (공개 — App Check 보호) |

### `submitPublicFeedback`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/handlers/https/submitPublicFeedback.ts` |
| **설명** | 랜딩 페이지 비로그인 방문자 문의 접수 |
| **인증** | 없음 (공개 — App Check 보호) |

### `backfillOrgCoords`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/handlers/callable/backfillOrgCoords.ts` |
| **설명** | 기존 기관에 좌표(lat/lng) 추가 (일회성 마이그레이션) |
| **인증** | superAdmin |

### `backfillMonthlyStats`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/handlers/callable/backfillMonthlyStats.ts` |
| **설명** | 월별 집계(orgStats/{orgId}/monthly) 소급 재집계. 야간 배치는 당월+전월만 갱신하므로 집계 로직 변경 후 과거 월을 교정할 때 1회 호출한다. |
| **인증** | superAdmin |
| **요청 파라미터** | `{ months?: number }` |
| **비고** | set(merge)라 멱등 — 타임아웃 시 재호출해도 안전 |

### `getSlackInstallUrl`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/handlers/callable/getSlackInstallUrl.ts` |
| **설명** | Slack 설치(OAuth) URL 발급. organizationId를 request.data가 아니라 인증 토큰의 orgId 클레임에서 가져와 브라우저 조작을 막고, 서명된 state + 1회성 nonce를 발급한다. |
| **인증** | 기관 관리자 |
| **반환값** | `{ url: string }` |

### `getSlackConnectionStatus`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/handlers/callable/getSlackConnectionStatus.ts` |
| **설명** | 기관의 Slack 연결 상태 조회 (설정 화면용). integrations 문서는 Rules로 클라이언트 접근이 차단돼 있어 이 콜러블이 안전 필드만 반환한다. |
| **인증** | 기관 관리자 이상 |
| **비고** | 토큰·암호문은 반환하지 않음 |

### `disconnectSlack`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/handlers/callable/disconnectSlack.ts` |
| **설명** | Slack 연결 해제. Slack 측 토큰 무효화(auth.revoke)를 베스트에포트로 시도한 뒤 암호화 토큰을 삭제하고 enabled:false / revoked:true로 표시한다. |
| **인증** | 기관 관리자 이상 |

### `diagnoseSlackConnection`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/handlers/callable/diagnoseSlackConnection.ts` |
| **설명** | Slack 워크스페이스 사용자 이메일과 기관 직원 이메일을 대조해 누가 봇을 쓸 준비가 됐는지 리포트. 토큰이 실제 동작해야 응답이 오므로 "연결 테스트"를 겸한다. |
| **인증** | 기관 관리자 이상 |

### `listSlackIntegrations`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/handlers/callable/listSlackIntegrations.ts` |
| **설명** | 전체 Slack 연결 기관 현황 (슈퍼관리자 대시보드용) |
| **인증** | superAdmin |
| **비고** | 토큰·암호문 제외한 안전 필드만 반환 |

---

## 🌐 onRequest (HTTP 요청)

> 총 4개

### `tmapProxy`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/handlers/https/tmapProxy.ts` |
| **설명** | 클라이언트에서 Tmap API를 CORS 없이 호출하기 위한 서버사이드 프록시 |
| **인증** | Firebase Auth 토큰 필수 + IP Rate Limit (Remote Config로 실시간 조정) |
| **요청 파라미터** | `query params: endpoint, keyword 등 (Tmap API 파라미터)` |

### `holidayProxy`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/handlers/https/holidayProxy.ts` |
| **설명** | 공공데이터포털 공휴일 API 프록시. API 키를 서버에서 관리. |
| **인증** | Firebase Auth 토큰 필수 + IP Rate Limit |
| **요청 파라미터** | `query params: solYear, numOfRows` |

### `slackEvents`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/handlers/https/slackEvents.ts` |
| **설명** | Slack Events API + Interactivity 수신. 3초 ack 제한 때문에 서명 검증과 slackTasks 문서 생성만 하고 즉시 200을 반환한다 (실제 처리는 onSlackTaskCreated). |
| **인증** | Slack 서명 검증 (x-slack-signature) |
| **비고** | task 문서 ID를 event_id로 고정해 재시도에 멱등 |

### `slackOauthCallback`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/handlers/https/slackOauthCallback.ts` |
| **설명** | Slack 설치 OAuth 콜백. state 검증 → nonce 1회 소비(트랜잭션) → code를 봇 토큰으로 교환 → 암호화 저장 → 앱으로 302 리다이렉트. |
| **인증** | 서명된 state + 1회성 nonce 검증 |
| **비고** | 이미 다른 기관에 연결된 워크스페이스는 거부(중복 바인딩 방지). 토큰은 렌더·로깅하지 않음 |

---

## ⏰ onSchedule (스케줄)

> 총 5개

### `reservationReminder`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/handlers/scheduled/reservationReminderScheduler.ts` |
| **설명** | 예약 임박 알림 및 미작성 운행일지 알림 발송. 같은 cron에 편승해 OCR 함수 워밍업도 수행한다. |
| **인증** | 시스템 자동 실행 |
| **비고** | schedule: "0 8-18 * * 1-5" (Asia/Seoul) — 평일 08~18시 매시 정각, 주말 스킵 |

### `syncCalendarToApp`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/handlers/scheduled/calendarSchedule.ts` |
| **설명** | Google Calendar → App 역방향 동기화. 외부에서 캘린더 이벤트 변경 시 App DB에 반영. |
| **인증** | 시스템 자동 실행 |
| **비고** | schedule: "0,30 6-22 * * 1-5" — 평일 06~22시 30분 주기, 실패 누적 캘린더 자동 제외 |

### `dailyNightlyBatch`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/handlers/scheduled/dailyNightlyBatch.ts` |
| **설명** | 통합 야간 배치: 월간 집계 캐싱 → 대시보드 통계 재집계 → Firestore 백업(GCS) → soft-delete 기관 30일 후 영구 삭제 → 인증서 이미지 정리 → 3년 이상 운행기록 아카이빙 → 차량 보험 만료 알림 |
| **인증** | 시스템 자동 실행 |
| **비고** | schedule: "0 2 * * *" (KST 02:00). 개별 스케줄러(backupFirestore·autoPurgeOrgs·archiveDriveLogs·cleanupCertificateImages)를 통합해 Cloud Scheduler 잡 수를 줄인 것 |

### `monthlyBatch`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/handlers/scheduled/monthlyBatch.ts` |
| **설명** | 통합 월배치: 공휴일 동기화(syncHolidays) + 차량 누적 주행거리 불일치 검증(verifyMileageConsistency) |
| **인증** | 시스템 자동 실행 |
| **비고** | schedule: "0 6 1 * *" (매월 1일 오전 6시). 각 단계는 독립 try/catch |

### `sendInactiveOrgAlimtalkScheduled`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/handlers/scheduled/sendInactiveOrgAlimtalkScheduled.ts` |
| **설명** | 미활성 기관 점검 및 주 1회 알림톡 발송 |
| **인증** | 시스템 자동 실행 |
| **비고** | schedule: "0 14 * * 1-5" — 평일 14시 점검 |

---

## 📝 Firestore onCreate

> 총 7개

### `onReservationCreated`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/handlers/triggers/reservationTriggers.ts` |
| **설명** | 예약 생성 시 Google Calendar 이벤트 생성 + 푸시 알림 발송 |
| **인증** | 시스템 자동 실행 |
| **비고** | reservations/{reservationId} |

### `onDriveLogCreated`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/handlers/triggers/syncDriveLogKm.ts` |
| **설명** | 운행일지 생성 시 차량 누적 주행거리 증분 + 집계 통계 갱신. 이후 시점 기록이 있으면 연쇄 동기화. |
| **인증** | 시스템 자동 실행 |
| **비고** | driveLogs/{logId} |

### `trackFirstEmployee`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/handlers/triggers/trackFirstEmployee.ts` |
| **설명** | 기관 첫 번째 직원 등록 시점을 Firestore에 기록 |
| **인증** | 시스템 자동 실행 |
| **비고** | users/{uid} |

### `generateFeedbackDraft`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/handlers/triggers/generateFeedbackDraft.ts` |
| **설명** | feedbacks/{feedbackId} 생성 시 Gemini API로 FAQ 매칭 + AI 답변 초안 자동 생성 |
| **인증** | 시스템 자동 실행 (Firestore 트리거) |

### `onSlackTaskCreated`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/handlers/triggers/onSlackTaskCreated.ts` |
| **설명** | Slack 어시스턴트 워커: 신원 매핑 → rate limit → 자연어 처리(예약 조회/생성 제안) 또는 확인 버튼 실행 → Slack 응답 |
| **인증** | 시스템 자동 실행 (Firestore 트리거) |
| **비고** | slackTasks/{taskId}. Admin SDK로 Rules를 우회하므로 이 워커의 org 검증이 유일한 방어선 |

### `auditDriveLogCreated`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/handlers/triggers/auditLog.ts` |
| **설명** | 운행일지 생성 이력을 접속기록(accessLogs)에 기록 — 고시 「개인정보의 안전성 확보조치 기준」 제16조 |
| **인증** | 시스템 자동 실행 |
| **비고** | driveLogs/{logId}. 화이트리스트 필드만 기록, retry: true |

### `auditUserCreated`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/handlers/triggers/auditLog.ts` |
| **설명** | 사용자 문서 생성 이력을 접속기록(accessLogs)에 기록 |
| **인증** | 시스템 자동 실행 |
| **비고** | users/{userId} |

---

## ✏️ Firestore onWrite

> 총 4개

### `autoVerifyDocument`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/handlers/triggers/autoVerifyDocument.ts` |
| **설명** | organizations/{orgId} 문서에 증빙서류(uniqueNumberImagePath, 레거시 uniqueNumberImageUrl)가 추가되면 Gemini OCR + 비영리 판별 → 자동 승인/거절 처리 및 이메일 발송 |
| **인증** | 시스템 자동 실행 (Firestore 트리거) |
| **비고** | 화이트리스트 기관은 즉시 승인. 종교/학교/병원/영리 사업자는 자동 거절. |

### `setCustomClaims`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/handlers/triggers/setCustomClaims.ts` |
| **설명** | users/{uid} 문서 변경 시 Firebase Auth Custom Claims (role, orgId) 자동 동기화 |
| **인증** | 시스템 자동 실행 (Firestore 트리거) |

### `notifyNewApplication`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/handlers/triggers/notifyNewApplication.ts` |
| **설명** | 기관 신청(pending)/승인(approved)/거절(rejected) 상태 변화 시 이메일 및 Discord 알림 발송 |
| **인증** | 시스템 자동 실행 (Firestore 트리거) |

### `notifyRoleChange`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/handlers/triggers/notifyRoleChange.ts` |
| **설명** | 사용자 권한(role) 변경 감지 시 Discord 보안 알림 발송 |
| **인증** | 시스템 자동 실행 |
| **비고** | users/{uid} |

---

## 🔄 Firestore onUpdate

> 총 4개

### `onReservationUpdated`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/handlers/triggers/reservationTriggers.ts` |
| **설명** | 예약 수정/취소 시 Google Calendar 이벤트 업데이트 |
| **인증** | 시스템 자동 실행 |

### `onDriveLogUpdated`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/handlers/triggers/syncDriveLogKm.ts` |
| **설명** | 운행일지 수정 시 차량 누적 주행거리 재계산 + 집계 통계 갱신 (충돌 시 conflictResolver로 해소) |
| **인증** | 시스템 자동 실행 |

### `auditDriveLogUpdated`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/handlers/triggers/auditLog.ts` |
| **설명** | 운행일지 변경 이력을 접속기록(accessLogs)에 기록 (변경 전/후 화이트리스트 필드) |
| **인증** | 시스템 자동 실행 |

### `auditUserUpdated`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/handlers/triggers/auditLog.ts` |
| **설명** | 사용자 개인정보 변경 이력을 접속기록(accessLogs)에 기록 |
| **인증** | 시스템 자동 실행 |

---

## 🗑️ Firestore onDelete

> 총 4개

### `onReservationDeleted`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/handlers/triggers/reservationTriggers.ts` |
| **설명** | 예약 삭제 시 Google Calendar 이벤트 삭제 |
| **인증** | 시스템 자동 실행 |

### `onDriveLogDeleted`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/handlers/triggers/syncDriveLogKm.ts` |
| **설명** | 운행일지 삭제 시 차량 누적 주행거리 되돌리기 + 집계 통계 갱신 |
| **인증** | 시스템 자동 실행 |

### `auditDriveLogDeleted`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/handlers/triggers/auditLog.ts` |
| **설명** | 운행일지 삭제 이력을 접속기록(accessLogs)에 기록 |
| **인증** | 시스템 자동 실행 |

### `auditUserDeleted`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/handlers/triggers/auditLog.ts` |
| **설명** | 사용자 문서 삭제 이력을 접속기록(accessLogs)에 기록 |
| **인증** | 시스템 자동 실행 |

---

## 👤 Auth 트리거

> 총 1개

### `onUserDelete`

| 항목 | 내용 |
|------|------|
| **파일** | `functions/src/handlers/triggers/onUserDelete.ts` |
| **설명** | Firebase Auth 계정 삭제 시 Firestore 개인정보 익명화 처리 |
| **인증** | 시스템 자동 실행 (Auth 트리거) |

---

## 업데이트 방법

새 함수를 추가하거나 변경했을 때:

```bash
npx tsx scripts/generate-functions-doc.ts
```

`scripts/generate-functions-doc.ts`의 `FUNCTIONS` 배열에 항목을 추가(또는 수정)한 뒤 위 명령을 실행한다. 배열의 `name`은 `functions/src/index.ts`의 export 목록과 1:1로 일치해야 한다.
