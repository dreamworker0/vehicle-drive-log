# Worker R1~R4 Progress

Last visited: 2026-05-29T08:18:00+09:00

## 현재 상태
코드 수정 완료 → 검증 단계 진행 중

## 작업 목록
- [ ] R1-A: useEmployeeManager.ts Firestore 직접 호출 격리
  - [ ] preRegistered.ts 신규 생성
  - [ ] users.ts에 restoreUser, clearUserOrganization 추가
  - [ ] useEmployeeManager.ts 수정
- [ ] R1-B: AuthGuard.tsx 수정
- [ ] R1-C: OrgMapView.tsx 수정
- [ ] R1-D: DashboardOrgTable.tsx 수정
- [ ] R1-E: firestore/index.ts 업데이트
- [ ] R2-A: useVehicleManager.ts eslint 블록 주석 제거 + useCallback
- [ ] R2-B: useEmployeeManager.ts eslint 블록 주석 제거 + useCallback
- [ ] R2-C: useHipassManager.ts eslint 블록 주석 제거 + useCallback
- [ ] R2-D: FavoritesManager.tsx eslint 블록 주석 제거 + useCallback
- [ ] R2-E: useAuth.tsx eslint 블록 주석 → 한줄 주석
- [ ] R3: useVehicleManager.ts IIFE → useMemo
- [ ] R4-A: constants.ts APP_URL 추가
- [ ] R4-B: useEmployeeManager.ts 하드코딩 URL 상수화
- [ ] 검증: lint → tsc → build → test

## 오류 기록
없음
