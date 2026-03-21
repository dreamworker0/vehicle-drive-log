# 🔄 배포 롤백 전략

> 프로덕션 장애 발생 시 안전하게 이전 상태로 되돌리는 절차.

---

## 장애 시 롤백 순서

> **Rules → Functions → Hosting** 순서로 롤백한다.
> 데이터 접근 규칙이 가장 먼저 안전해야 하고, 프론트엔드는 마지막에 복구한다.

```
1. Firestore/Storage Rules 롤백  (데이터 보호 최우선)
2. Cloud Functions 롤백           (서버 로직 복구)
3. Hosting 롤백                   (프론트엔드 복구)
```

---

## 1. Firebase Hosting 롤백

### 방법 A: Firebase Console (가장 빠름)
1. [Firebase Console](https://console.firebase.google.com) → Hosting
2. **릴리즈 기록**에서 이전 버전 옆 `⋮` 클릭
3. **"롤백"** 선택 → 즉시 반영 (캐시 무효화 포함)

### 방법 B: CLI
```bash
firebase hosting:rollback --project vehicle-drive-log
```

### 방법 C: 이전 커밋으로 재배포
```bash
git log --oneline -5                    # 이전 정상 커밋 확인
git checkout <commit-hash>              # 해당 커밋으로 이동
npm run build                           # 빌드
firebase deploy --only hosting          # Hosting만 배포
git checkout master                     # 원래 브랜치로 복귀
```

---

## 2. Cloud Functions 롤백

### 방법 A: 이전 커밋에서 재배포 (추천)
```bash
git log --oneline -5                    # 이전 정상 커밋 확인
git checkout <commit-hash>              # 해당 커밋으로 이동
cd functions && npm ci && npm run build # 의존성 설치 + 빌드
cd .. && firebase deploy --only functions --project vehicle-drive-log
git checkout master                     # 원래 브랜치로 복귀
```

### 방법 B: GCP Console에서 트래픽 전환
1. [Cloud Console](https://console.cloud.google.com) → Cloud Functions
2. 해당 함수 선택 → **수정 버전** 탭
3. 이전 버전으로 트래픽 100% 전환

### 특정 함수만 롤백
```bash
# 특정 함수만 재배포
firebase deploy --only functions:ocrDashboard,functions:joinOrganization
```

---

## 3. Firestore Rules 롤백

### 방법 A: Firebase Console (가장 빠름)
1. Firebase Console → Firestore → **규칙** 탭
2. **규칙 기록** 클릭 → 이전 버전 선택
3. **되돌리기** 버튼

### 방법 B: Git에서 이전 규칙 복원
```bash
git log --oneline -- firestore.rules    # 이전 정상 버전 확인
git checkout <commit-hash> -- firestore.rules
firebase deploy --only firestore:rules --project vehicle-drive-log
```

### Storage Rules도 동일
```bash
git checkout <commit-hash> -- storage.rules
firebase deploy --only storage --project vehicle-drive-log
```

---

## 4. 배포 전 체크리스트

배포 전에 아래 항목을 확인하여 롤백 필요성을 최소화한다:

- [ ] `npm run build` 성공
- [ ] `npx vitest run` 전체 테스트 통과
- [ ] `cd functions && npm run build && npm test` Functions 빌드+테스트 통과
- [ ] `npx tsc --noEmit` 타입 체크 통과
- [ ] Firestore Rules 변경 시 → `firebase deploy --only firestore:rules` 먼저 단독 배포

> **💡 Tip**: 워크플로우 `/deploy`를 사용하면 빌드→테스트→배포를 한 번에 실행합니다.

---

## 5. 장애 대응 커뮤니케이션

| 단계 | 행동 |
|------|------|
| **감지** | Sentry 알림 또는 사용자 피드백으로 장애 확인 |
| **판단** | Cloud Functions 로그 확인 (`/logs` 워크플로우) |
| **롤백** | 위 순서에 따라 영향 범위에 맞게 롤백 |
| **확인** | 서비스 정상 동작 확인 (주요 기능 수동 테스트) |
| **원인 분석** | 장애 원인 파악 후 수정 → 재배포 |
