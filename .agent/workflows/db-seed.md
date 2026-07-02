---
description: Firebase 로컬 Emulator에 프론트엔드 및 E2E 테스트용 더미 데이터를 자동 주입하는 스크립트 도우미
---

# 로컬 DB 시드 주입 (DB Seed)

로컬 Emulator에 개발·E2E 테스트용 가상 데이터를 주입합니다.
시드 로직의 단일 원본은 [e2e/emulator/seed.ts](../../e2e/emulator/seed.ts)입니다 —
Auth 계정(admin/employee + custom claims `{ role, orgId }`), 조직(`e2e-org`), 차량을 만듭니다.

> [!WARNING]
> 반드시 에뮬레이터 환경변수(`FIREBASE_AUTH_EMULATOR_HOST` / `FIRESTORE_EMULATOR_HOST`)가
> 설정된 상태로 실행해야 합니다. 실제 프로덕션 DB에 실행되지 않도록 주의하세요!

## 1. E2E 용도 — 자동, 별도 조치 불필요

`npm run test:e2e:emulator`가 `firebase emulators:exec` 안에서 Playwright globalSetup
([e2e/emulator/global-setup.ts](../../e2e/emulator/global-setup.ts))으로 시드를 자동 실행합니다.

## 2. 수동 시드 — 에뮬레이터 UI·프론트 개발용

1. 에뮬레이터 실행 (별도 터미널에서 유지):
```
firebase emulators:start --only auth,firestore
```
Working directory: `.`

2. 시드 주입 (에뮬레이터 호스트를 지정해 admin SDK가 에뮬레이터를 타겟하도록):
```
$env:FIREBASE_AUTH_EMULATOR_HOST='127.0.0.1:9099'; $env:FIRESTORE_EMULATOR_HOST='127.0.0.1:8080'; npx tsx -e "import('./e2e/emulator/seed.ts').then(m => m.seedEmulator()).then(() => console.log('시드 완료'))"
```
Working directory: `.`

3. (선택) 프론트엔드를 에뮬레이터 모드로 실행 — `.env.emulator`의 `VITE_USE_EMULATOR=true`가 적용됩니다:
```
npm run dev -- --mode emulator --host 127.0.0.1
```
Working directory: `.`
> 💡 Windows에서는 `--host 127.0.0.1`로 IPv4 바인딩해야 합니다(localhost→::1 불일치 방지).

## 3. 시드 데이터 확장

새 시나리오용 데이터가 필요하면 별도 시드 스크립트를 만들지 말고 `e2e/emulator/seed.ts`에
추가합니다 (시드 단일 원본 유지 — E2E와 수동 개발이 같은 데이터를 공유).

---
> **완료 메세지**
> 더미 데이터 주입이 완료되었습니다. 에뮬레이터 UI(`http://127.0.0.1:4000`) 또는 대시보드를 새로고침하여 데이터가 정상적으로 렌더링되는지 확인해 주세요.
