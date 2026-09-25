# 차량운행일지 프로그램 종합 구조도 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 비개발자와 개발자가 차량운행일지의 사용자·화면·프론트엔드·Firebase·Cloud Functions·외부 서비스 구조와 데이터 흐름을 한 장에서 이해할 수 있는 한글 PNG 구조도를 만든다.

**Architecture:** 저장소에서 검증한 구성요소를 위에서 아래로 흐르는 6개 계층으로 배치한다. 정확한 한글 라벨과 연결 관계를 프롬프트에 고정하고, 생성 이미지를 시각 검수한 뒤 프로젝트 문서 이미지 디렉터리에 보관한다.

**Tech Stack:** OpenAI built-in image generation, PNG, PowerShell 파일 검증, Codex 이미지 검사

## Global Constraints

- 한글 가로형 고해상도 PNG 이미지 1개를 만든다.
- 사용자 역할, 역할별 화면, 프론트엔드, Firebase, Cloud Functions, 외부 서비스를 모두 포함한다.
- 실제 저장소에 존재하는 구성요소만 표시한다.
- 색상뿐 아니라 제목, 그룹 경계, 선 종류로 계층과 흐름을 구분한다.
- 작은 화면에서도 확대하여 읽을 수 있도록 짧고 정확한 라벨을 사용한다.
- 로고, 워터마크, 장식적 배경은 사용하지 않는다.
- 기존 사용자 변경 파일 `.claude/settings.local.json`은 수정하거나 커밋하지 않는다.

---

## File Structure

- Create: `docs/images/vehicle-drive-log-architecture.png` — 최종 종합 구조도 이미지
- Reference: `docs/superpowers/specs/2026-07-19-program-architecture-diagram-design.md` — 승인된 구성·흐름·검증 기준
- Create: `docs/superpowers/plans/2026-07-19-program-architecture-diagram.md` — 이 실행 계획

### Task 1: 근거와 프롬프트 확정

**Files:**
- Read: `docs/superpowers/specs/2026-07-19-program-architecture-diagram-design.md`
- Read: `README.md`
- Read: `src/App.tsx`
- Read: `functions/src/index.ts`
- Read: `firebase.json`

**Interfaces:**
- Consumes: 승인된 구조도 설계와 저장소의 실제 구성
- Produces: built-in 이미지 생성 도구에 전달할 완성형 `infographic-diagram` 프롬프트

- [ ] **Step 1: 핵심 계층과 라벨 확인**

  다음 6개 계층이 설계 문서와 일치하는지 확인한다: `사용자 역할`, `화면과 핵심 기능`, `프론트엔드`, `Firebase 플랫폼`, `Cloud Functions`, `외부 서비스`.

- [ ] **Step 2: 정확한 생성 프롬프트 사용**

```text
Use case: infographic-diagram
Asset type: software architecture overview image for project documentation
Primary request: 차량운행일지 프로그램의 사용자 관점 서비스 구조와 개발자 관점 기술 구조를 한 장에 보여 주는 종합 구조도
Scene/backdrop: 밝고 깨끗한 중립 배경, 장식 없는 기술 문서 스타일
Style/medium: 정교한 벡터형 소프트웨어 아키텍처 인포그래픽, 둥근 사각형 노드, 균일한 간격, 선명한 한글 산세리프 글꼴
Composition/framing: 16:9 가로형, 위에서 아래로 읽는 6개 계층, 같은 계층의 노드는 가로로 정렬, 넉넉한 여백
Text (verbatim): "차량운행일지 프로그램 종합 구조도", "시스템 관리자", "기관관리자", "기관직원", "화면과 핵심 기능", "서비스 대시보드 · 기관 관리 · 의견 · API 상태", "직원 · 차량 · 운행일지 · 예약 · 통계 · 정비 · 설정", "오늘 현황 · 운행일지 OCR · 빠른 운행 · 예약 · 내 기록", "공통: 로그인 · 알림 · AI 도움말 · PWA · 오프라인", "프론트엔드", "React 19 · Vite 7 · TypeScript PWA", "라우팅 · AuthGuard · 역할별 컴포넌트", "Hooks · Firestore 모듈 · Zod", "Zustand · IndexedDB · 동기화 큐", "PDF · Excel · Service Worker · Sentry", "Firebase 플랫폼", "Hosting", "Authentication", "Cloud Firestore", "Cloud Storage", "Cloud Messaging", "Rules · 기관 격리 · 역할 권한", "주요 데이터: 기관 · 사용자 · 차량 · 운행일지 · 예약 · 주유 · 하이패스 · 정비 · 알림 · 통계", "Cloud Functions", "호출형: OCR · 예약 · 가입 · 사용자 · 알림 · Slack · 캘린더", "HTTP: TMAP · 공휴일 · 기관 신청 · Slack · API 상태", "트리거: 문서 검증 · 예약 · 권한 · 주행거리 · 의견 AI", "예약·배치: 알림 · 캘린더 · 집계 · 백업 · 아카이빙", "외부 서비스", "Gemini AI", "Google Calendar", "TMAP", "Slack", "공공데이터포털", "FCM · 알림톡 · 이메일", "Sentry", "실선: 사용자 요청·데이터 접근", "점선: 트리거·예약 작업", "화살표: 외부 API 통신"
Color palette: 계층별로 절제된 파랑, 청록, 보라, 주황 계열의 옅은 면 색상; 진한 중립색 글자; 높은 대비
Constraints: 모든 한글 문구를 정확히 한 번씩 렌더링; 위에서 아래로 사용자→화면→프론트엔드→Firebase/Cloud Functions→외부 서비스 흐름; 프론트엔드에서 Firestore와 Cloud Functions로 연결; Firestore에서 트리거와 예약·배치로 점선 연결; Cloud Functions에서 외부 서비스로 화살표 연결; 계층 제목과 그룹 경계를 명확히 표시; 잘림과 겹침 금지; 작은 글자 금지; 구현되지 않은 서비스 추가 금지; 로고·워터마크 금지
Avoid: 사진풍, 3D, 아이소메트릭, 장식 아이콘 남용, 임의 영문 라벨, 깨진 한글, 중복 문구, 복잡하게 교차하는 선
```

- [ ] **Step 3: 설계 대비 프롬프트 검토**

  프롬프트의 모든 구성요소가 설계 문서의 `구성요소`, `주요 데이터 흐름`, `검증 기준` 중 하나에 대응하고, 새로운 서비스나 데이터 도메인을 만들지 않았는지 확인한다.

### Task 2: 구조도 생성과 프로젝트 저장

**Files:**
- Create: `docs/images/vehicle-drive-log-architecture.png`

**Interfaces:**
- Consumes: Task 1의 완성형 프롬프트
- Produces: 최종 후보 PNG 이미지

- [ ] **Step 1: built-in 이미지 생성 실행**

  Task 1의 프롬프트를 built-in 이미지 생성 도구에 전달한다. 새 이미지이므로 참조 이미지 인수는 전달하지 않는다.

- [ ] **Step 2: 결과 이미지를 프로젝트로 복사**

  생성 결과가 알려 준 실제 파일 경로를 확인하고 `docs/images/vehicle-drive-log-architecture.png`로 복사한다. `docs/images`가 없으면 먼저 생성한다. 기존 동명 파일이 있으면 덮어쓰지 않고 `vehicle-drive-log-architecture-v2.png`를 사용한다.

- [ ] **Step 3: 파일 존재와 형식 확인**

Run:
```powershell
Get-Item 'docs\images\vehicle-drive-log-architecture.png' | Select-Object FullName,Length
Add-Type -AssemblyName System.Drawing
$image = [System.Drawing.Image]::FromFile((Resolve-Path 'docs\images\vehicle-drive-log-architecture.png'))
[PSCustomObject]@{ Width=$image.Width; Height=$image.Height; Format=$image.RawFormat }
$image.Dispose()
```

Expected: 파일 크기가 0보다 크고, 너비가 높이보다 크며, 이미지 형식이 PNG다.

### Task 3: 시각 검증과 필요한 수정

**Files:**
- Inspect: `docs/images/vehicle-drive-log-architecture.png`
- Replace only if validation fails: `docs/images/vehicle-drive-log-architecture.png`

**Interfaces:**
- Consumes: Task 2의 PNG 이미지와 설계 문서의 검증 기준
- Produces: 잘림·겹침·깨진 글자·잘못된 연결이 없는 검증된 PNG

- [ ] **Step 1: 이미지를 원본 해상도로 검사**

  이미지 검사 도구로 PNG를 열고 제목, 6개 계층, 세 사용자 역할, 주요 Firebase 구성, 네 가지 Functions 유형, 일곱 외부 서비스 그룹, 범례를 확인한다.

- [ ] **Step 2: 오류 목록 판정**

  다음 중 하나라도 있으면 실패로 판정한다: 한글 오탈자, 누락된 계층, 겹친 라벨, 화면 밖 잘림, 방향이 반대인 화살표, 프론트엔드와 Firebase 경계 혼동, 구현되지 않은 구성요소, 워터마크.

- [ ] **Step 3: 실패 시 한 번에 한 종류만 수정**

  원본 생성 결과를 편집 대상으로 포함하고 `누락 라벨만 추가`, `깨진 한글만 교정`, `교차 연결선만 정리`처럼 하나의 변화만 요청한다. 수정 후 Step 1과 Step 2를 반복한다.

- [ ] **Step 4: 최종 파일 상태 확인**

Run:
```powershell
git status --short -- 'docs/images/vehicle-drive-log-architecture.png'
```

Expected: 최종 PNG 한 파일만 새 문서 이미지 자산으로 표시된다.

### Task 4: 최종 검증과 커밋

**Files:**
- Add: `docs/images/vehicle-drive-log-architecture.png`

**Interfaces:**
- Consumes: Task 3에서 검증된 PNG
- Produces: 프로젝트에 커밋된 최종 구조도 자산

- [ ] **Step 1: 설계 기준 최종 체크**

  설계 문서의 여섯 검증 기준을 모두 다시 확인하고, 각 기준이 이미지에서 눈으로 확인되는지 기록한다.

- [ ] **Step 2: 관련 파일만 스테이징**

Run:
```powershell
git add -- 'docs/images/vehicle-drive-log-architecture.png'
git diff --cached --stat
```

Expected: 구조도 PNG만 스테이징되고 `.claude/settings.local.json`은 포함되지 않는다.

- [ ] **Step 3: 이미지 자산 커밋**

Run:
```powershell
git commit -m "docs: add program architecture diagram"
```

Expected: 커밋이 성공하고 구조도 PNG 한 파일이 기록된다.

- [ ] **Step 4: 사용자에게 결과 전달**

  클릭 가능한 최종 파일 경로, 이미지 생성에 사용한 최종 프롬프트, built-in 이미지 생성 방식을 사용했다는 사실, 검증 결과를 한국어로 보고한다.
