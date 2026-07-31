---
description: 프로젝트 초기 설정(의존성 설치, 환경변수 템플릿 복사, Husky 훅 설치, 검증)을 수행하는 온보딩 자동화 스크립트
---

# 프로젝트 환경 설정 스크립트 (Setup / Onboard)

처음 저장소를 클론받았거나, 다른 컴퓨터·클라우드 세션에서 작업을 이어받을 때 실행한다.
아래를 순서대로 실행하면 즉시 개발에 투입 가능한 상태가 된다.

> [!IMPORTANT]
> 아래 명령은 Windows·macOS·Linux에서 동일하게 동작하도록 `node -e`를 사용한다.
> 셸 전용 문법(PowerShell `Copy-Item` 등)을 쓰면 다른 OS에서 실패한다.

## 1. Node 버전 확인 (Node 22 LTS 필수)

Node 24는 Rollup 빌드가 실패한다. `.node-version`에 22가 고정되어 있어 fnm/nvm은 자동 인식한다.

```bash
// turbo
npm run check:node
```

실패하면 `fnm use 22` (또는 `nvm use 22`) 후 다시 실행한다.

## 2. 패키지 의존성 설치

루트와 `functions/`는 별도 패키지다. **둘 다** 설치해야 `type-check:functions`와 Functions 테스트가 동작한다.

```bash
// turbo
npm ci
```

```bash
// turbo
npm ci --prefix functions
```

> [!NOTE]
> 락파일 고정을 위해 `npm install`이 아닌 `npm ci`를 쓴다 (CI와 동일).

## 3. 환경변수 파일 준비

`.env`(프론트엔드)와 `functions/.env`(Functions)를 템플릿에서 복사한다. 이미 있으면 건드리지 않는다.

```bash
// turbo
node -e "const fs=require('fs');[['.env.example','.env'],['.env.local.example','.env.local'],['functions/.env.example','functions/.env']].forEach(([s,d])=>{if(!fs.existsSync(s))return console.log('templ 없음, 건너뜀: '+s);if(fs.existsSync(d))return console.log('이미 존재: '+d);fs.copyFileSync(s,d);console.log('생성됨: '+d+' — 값을 채워야 한다')})"
```

> [!IMPORTANT]
> 복사만으로는 값이 비어 있다. **`.env`의 Firebase 필수 6개 키를 채우지 않으면 빌드가 중단되고,
> `pre-push` 훅이 빌드를 돌리므로 푸시도 막힌다.** 값은 Firebase Console 또는 GitHub Secrets(`ENV_FILE`)에서 가져온다.
> `VITE_` 접두사 값은 공개 번들에 박히므로 서버 전용 비밀은 절대 넣지 않는다.

## 4. Husky 훅 초기화

```bash
// turbo
npm run prepare
```

## 5. 설치 검증

`verify:fast`가 Node 확인 + lint + 타입 검사(프론트/Functions)를 한 번에 수행한다.

```bash
// turbo
npm run verify:fast
```

```bash
// turbo
npm run build
```

> [!NOTE]
> `npm run test:rules`와 에뮬레이터 기반 작업은 firebase CLI가 필요하다.
> 없으면 `npx firebase-tools --version`으로 받아 쓸 수 있다 (CI도 npx 방식).

---
> **완료 메세지**
> 설정이 완료되었습니다! `npm run dev`로 개발 서버를 시작하세요.
> 검증이 실패했다면 위 3번의 환경변수 값이 비어 있는지 먼저 확인하세요.
