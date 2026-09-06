---
name: pre-deploy-check
description: Firebase 배포 직전에 type-check, lint, test, 번들 크기, 인덱스 동기화, 환경 변수, CHANGELOG 갱신을 일괄 점검한다. 사용자가 "배포 전 점검", "배포 준비", "릴리즈 준비", "배포 가능한지 확인" 등을 요청할 때 발동한다.
---

# 배포 전 점검 (pre-deploy-check)

차량 운행일지 프로젝트의 배포 직전 루틴. 최근 커밋 기록에 "배포 전 문서 및 환경 갱신 완료"가 반복적으로 등장하는 작업을 표준화한다.

## 발동 조건

- 사용자가 "배포 준비", "배포 전 점검", "배포해도 되는지 확인", "릴리즈 노트 갱신" 등을 명시했을 때
- `firebase deploy` 실행 직전
- `chore: 배포 전 ...` 커밋 직전

## 점검 순서 (순서 중요)

### 1. Node 버전 확인

```bash
node --version  # v22.x 여야 함. v24는 Rollup 빌드 실패
```

22가 아니면 사용자에게 `fnm use 22` 실행 요청 후 중단.

### 2. 정적 검사 (병렬 실행 가능)

```bash
npm run type-check
npm run lint
```

- 에러 0건이 통과 조건. 경고(warning)는 lint-staged에서 `--max-warnings=0`으로 막혀 있으므로 사실상 0건이어야 함.
- 실패 시 사용자에게 보고하고 중단. 자의로 코드를 고치지 말 것.

### 3. 단위 테스트

```bash
npm test
```

- 새로 추가/수정된 코드 경로에 대한 테스트가 누락되지 않았는지 함께 확인.
- Firestore Rules를 수정했다면 `npm run test:rules`도 실행.

### 4. 번들 사이즈 점검

```bash
npm run build
```

- `postbuild` 훅이 `scripts/check-bundle-size.ts`로 자동 체크. 임계치 초과 시 빌드가 실패한다.
- 통과 시 `dist/` 산출물 확인.

### 5. Firestore 인덱스 동기화

새 복합 쿼리(`where + orderBy`, `where + where + orderBy` 등)가 추가됐다면 `firestore.indexes.json`에 인덱스가 있는지 확인:

```bash
# 최근 변경된 firestore 쿼리 검토
git diff master -- src/lib/firestore/ functions/src/
```

인덱스 누락은 운영에서만 터지는 사일런트 실패. 의심되면 사용자에게 확인 요청.

### 6. 환경 변수 점검

```bash
# 새 VITE_* 변수가 코드에 추가됐는데 .env.local.example에 빠졌는지
git diff master -- src/ | grep -oE 'VITE_[A-Z_]+'
```

`functions/src/`에 새 `process.env.*` 참조가 추가됐다면 Firebase Functions 환경변수에도 설정 필요(`firebase functions:config` 또는 `.env`).

### 7. CHANGELOG 갱신

`CHANGELOG.md`에 이번 배포 분 변경사항이 반영됐는지 확인. Phase 단위 작업이면 Phase 번호 포함. 누락 시 사용자에게 작성 의사 확인 후 진행 (자동으로 임의 작성 금지).

### 8. 업데이트 소식(공지) 누락 점검

```bash
npm run check:release-notes
```

`public/data/releaseNotes.json`을 마지막으로 건드린 커밋 이후의 **사용자 화면을 바꾼 feat/fix**를 나열한다. 후보가 있으면 [release-notes 스킬](../release-notes/SKILL.md) 규칙대로 항목을 추가한다. 알릴 내용이 아닌 변경이면 `-- --soft`로 확인만 하고 넘어간다 — 판단은 사람이 한다.

```bash
npm run check:faq
```

이쪽은 git을 보지 않는다. 공지의 **새 기능 항목(`type: "new"`)** 에 그것을 설명하는 FAQ id가 적혀 있는지만 본다. FAQ가 필요 없다고 판단했으면 `"faq": []`로 넘어간다 — 여기서도 판단은 사람이 한다. 다만 **끊긴 연결(없는 id)과 배열이 아닌 값은 `--soft`로도 통과하지 않는다.** 그건 판단할 것이 없는 그냥 오류다.

기능이 나갔는데 공지가 없으면 사용자는 화면이 달라진 이유를 알 수 없다. 실제로 다섯 건이 공지 없이 배포된 전례가 있다.

### 9. Cloud Functions 헬스 체크 (선택)

```bash
npm run health
```

배포 *후* 점검 용도이지만, 직전 배포가 의심스럽거나 외부 API 의존성 변경이 있다면 사전 한 번 더.

## 보고 형식

각 단계 결과를 다음 형식으로 요약:

```
✓ Node 22.x 확인
✓ type-check 통과
✓ lint 통과 (0 errors, 0 warnings)
✓ 단위 테스트 49/49 통과
✓ 빌드 성공 (번들 크기 임계치 내)
⚠ firestore.indexes.json — 새 쿼리 X건 검토 필요: <파일:라인>
✗ CHANGELOG.md — 이번 배포 분 항목 누락
✗ 업데이트 소식 — 공지 미반영 후보 2건 (feat: … / fix: …)

배포 가능 여부: 차단 (CHANGELOG·업데이트 소식 갱신 필요)
```

차단 항목이 있으면 사용자 확인 전까지 `firebase deploy` 제안하지 말 것.

## 자주 놓치는 것

- **Functions index.ts export 누락** — 새 함수를 `functions/src/index.ts`에서 export하지 않으면 배포돼도 호출 불가.
- **firestore.rules 변경 후 룰 테스트 누락** — `npm run test:rules`는 별도로 돌려야 한다.
- **PWA 캐시 무효화** — 서비스워커(`src/sw.ts`, 빌드 시 dist/sw.js로 생성)나 `index.html` cache-control 변경 없이 배포 시 구버전이 잔존. 최근 커밋(`14d59ac`)에서도 발생한 패턴.
- **App Check 토큰 디버그 모드** — `b295455` 커밋처럼 프로덕션에 debug token이 새지 않는지 빌드 산출물 grep.
- **업데이트 소식 누락** — 배포는 됐는데 공지가 그대로인 일이 반복된다(Phase 143~145에서 다섯 건). `npm run check:release-notes`가 기계로 잡아 주므로 반드시 돌린다.
- **FAQ 누락** — 공지는 나갔는데 FAQ에 없는 일이 반복된다. 출발지·분관 기능은 공지가 네 번 나가는 동안 FAQ 항목이 하나도 없었다(2026-09-06 발견). `npm run check:faq`가 새 기능 공지의 FAQ 연결이 비었는지 잡아 준다 — 필요 여부는 사람이 판단하되(`"faq": []`로 넘길 수 있다), 판단을 건너뛰는 것은 막는다.
