# 🛠️ 운영 가이드 (OPERATIONS)

> 슈퍼관리자 및 운영 담당자를 위한 서비스 운영 매뉴얼

---

## 1. 일상 운영 체크리스트

### 매일 확인

| 항목 | 확인 방법 | 정상 기준 |
|------|----------|----------|
| Functions 에러 | `npm run health` 또는 Firebase Console → Functions → 로그 | ERROR 0건 |
| Firestore 백업 | Cloud Storage → `backups/firestore/YYYY-MM-DD/` | 오늘 날짜 폴더 존재 |
| Sentry 에러 | [Sentry 대시보드](https://sentry.io) | 새 이슈 없음 |

### 주간 확인

| 항목 | 확인 방법 |
|------|----------|
| Dependabot 알림 | GitHub → Security → Dependabot alerts |
| npm 보안 감사 | `npm run audit` |
| Functions 사용량 | Firebase Console → Functions → 사용량 탭 |
| Firestore 읽기/쓰기 | Firebase Console → Firestore → Usage 탭 |

---

## 2. 기관 관리 절차

### 2.1 기관 신청 승인

```
1. 슈퍼관리자 로그인 → 기관 신청 관리
2. "대기 중" 탭에서 신청 확인
3. AI 검증 결과 확인:
   - ✅ aiVerified: true → 이미 자동 승인됨
   - ⚠️ aiVerified: false → 수동 검토 필요
     → 고유번호증 사본 이미지 확인
     → 기관명 일치 여부, 문서 유형 확인
4. "승인" 클릭 → 초대 코드 자동 생성 + 이메일 발송
5. 이메일 발송 실패 시 → 수동으로 초대 코드 전달
```

### 2.2 기관 삭제

```
1. 기관 관리 → 대상 기관 → "삭제" 클릭
2. soft delete 적용 (status: 'deleted')
3. 소속 직원은 즉시 로그인 불가 (실시간 감지)
4. 30일 이내: "삭제된 기관" 탭에서 복구 가능
5. 30일 경과: autoPurgeOrgs 함수가 자동 영구 삭제
```

### 2.3 기관 복구

```
1. 기관 관리 → "삭제된 기관" 탭
2. 대상 기관 → "복구" 클릭
3. status가 'approved'로 복원
4. 소속 직원이 다시 로그인 가능
```

---

## 3. 장애 대응

### 3.1 Cloud Functions 에러 발생 시

```bash
# 최근 에러 로그 조회
npm run health

# 또는 Firebase CLI로 직접 확인
firebase functions:log --only ocrDashboard,autoVerifyDocument
```

**자주 발생하는 에러:**

| 에러 | 원인 | 조치 |
|------|------|------|
| `Gemini API quota exceeded` | AI API 일일 한도 초과 | Google Cloud Console → API 할당량 확인/증가 |
| `messaging/registration-token-not-registered` | FCM 토큰 만료 | 자동 삭제됨 (조치 불필요) |
| `EMAILJS: 401 Unauthorized` | EmailJS 키 만료 | `functions/.env`에서 키 갱신 후 `firebase deploy --only functions` |

### 3.2 외부 API 장애 시

> 자세한 내용: [API_FALLBACK.md](docs/API_FALLBACK.md)

| API | 영향 | 대응 |
|-----|------|------|
| 티맵 API | 경로 탐색 불가 (수동 입력은 가능) | 티맵 개발자센터 상태 확인 |
| 공휴일 API | 신규 공휴일 미반영 (기존 캐시는 유지) | Firestore `system/holidays` 수동 입력 |
| Google Calendar API | 예약↔캘린더 동기화 중단 | Google Cloud Console → API 상태/할당량 확인 |

### 3.3 서비스 전체 장애 시

1. [Firebase Status](https://status.firebase.google.com/) 확인
2. Firebase Console → Hosting → 최근 배포 롤백 검토
3. Sentry 대시보드에서 에러 패턴 확인
4. 필요 시 이전 버전 재배포: `firebase hosting:clone <version> live`

---

## 4. 데이터 관리

### 4.1 백업 확인

- **자동 백업**: `dailyNightlyBatch` 함수(매일 02:00 KST)의 첫 단계에서 Firestore 전체 export 실행
- **저장 위치**: Cloud Storage → `backups/firestore/YYYY-MM-DD/`
- **포함 컬렉션**: organizations, users, vehicles, driveLogs, reservations, notifications

```bash
# Firebase Console에서 확인
# Cloud Storage → 버킷 → backups/firestore/ 폴더
```

### 4.2 데이터 아카이빙

- `dailyNightlyBatch` 함수(매일 02:00 KST)의 아카이빙 단계에서 실행
- 3년 이상 된 운행 기록 → Cloud Storage로 이동 후 Firestore에서 삭제
- 아카이빙된 데이터 위치: Cloud Storage → `archives/driveLogs/`

### 4.3 데이터 복구 (수동)

Firestore 백업에서 복구가 필요한 경우:

1. Cloud Storage에서 해당 날짜의 백업 JSON 다운로드
2. Firebase Console → Firestore → 수동으로 문서 생성
3. 또는 Firebase Admin SDK 스크립트로 일괄 복원

---

## 5. 보안 관리

### 5.1 환경변수 갱신

| 키 | 갱신 주기 | 갱신 방법 |
|----|----------|----------|
| `GEMINI_API_KEY` | API 키 변경 시 | `functions/.env` 수정 → `firebase deploy --only functions` |
| `EMAILJS_*` | 키 만료 시 | EmailJS 대시보드에서 재발급 → `.env` 수정 |
| `VITE_TMAP_APP_KEY` | 키 만료 시 | 티맵 개발자센터에서 재발급 → `.env` 수정 → 빌드+배포 |
| `VITE_SENTRY_DSN` | 프로젝트 변경 시 | Sentry 대시보드 → `.env` 수정 → 빌드+배포 |

### 5.2 Firebase 보안 규칙

```bash
# 현재 규칙 확인
cat firestore.rules
cat storage.rules

# 규칙만 배포
firebase deploy --only firestore:rules,storage
```

**핵심 원칙:**
- 슈퍼관리자: 모든 organizations 읽기/쓰기
- 기관관리자: 자기 기관 데이터만
- 직원: 자기 기관 읽기, 자기 기록만 쓰기
- 기관 간 데이터 완전 격리 (`organizationId` 기반)

---

## 6. 모니터링 도구

| 도구 | 대상 | URL |
|------|------|-----|
| Firebase Console | Firestore, Auth, Functions, Hosting | [console.firebase.google.com](https://console.firebase.google.com) |
| Sentry | 프론트엔드 런타임 에러 | Sentry 프로젝트 대시보드 |
| GitHub Actions | CI/CD 파이프라인 상태 | GitHub → Actions 탭 |
| Cloud Storage | 백업 데이터 | Firebase Console → Storage |

---

## 7. 유용한 명령어 모음

```bash
# 개발 서버 실행
npm run dev

# 전체 배포
fnm use 22 && npm run build && firebase deploy

# Functions만 배포
firebase deploy --only functions

# 보안 규칙만 배포
firebase deploy --only firestore:rules,storage

# Functions 로그 확인
firebase functions:log -n 50

# 보안 감사
npm run audit

# Functions 상태 점검
npm run health

# 단위 테스트
npm test

# E2E 테스트
npm run test:e2e
```
