# Handoff Report — R1~R4 리팩토링 완료

## 1. Observation

### 수정 파일 목록

| 파일 | 작업 | 변경 요약 |
|------|------|-----------|
| `src/lib/firestore/preRegistered.ts` | **신규** | 사전 등록 직원 Firestore 함수 분리 (getPreRegisteredEmployees, addPreRegisteredEmployee, deletePreRegisteredEmployee) |
| `src/lib/firestore/users.ts` | 수정 | restoreUser, clearUserOrganization 함수 추가 |
| `src/lib/firestore/index.ts` | 수정 | preRegistered 모듈 export + restoreUser, clearUserOrganization export 추가 |
| `src/types/organization.ts` | 수정 | lat?, lng? 필드 추가 |
| `src/lib/constants.ts` | 수정 | APP_URL 상수 추가 |
| `src/hooks/useEmployeeManager.ts` | 수정 | R1(Firestore 직접 호출 제거), R2-B(useCallback), R4-B(APP_URL) 통합 적용 |
| `src/components/auth/AuthGuard.tsx` | 수정 | R1: clearUserOrganization으로 교체 |
| `src/components/superAdmin/OrgMapView.tsx` | 수정 | R1: updateOrganization으로 교체 |
| `src/components/superAdmin/dashboard/DashboardOrgTable.tsx` | 수정 | R1: updateOrganization으로 교체 |
| `src/hooks/useVehicleManager.ts` | 수정 | R2-A(useCallback), R3(useMemo) 적용 |
| `src/hooks/useHipassManager.ts` | 수정 | R2-C(useCallback) 적용 |
| `src/components/employee/FavoritesManager.tsx` | 수정 | R2-D(useCallback) 적용 |
| `src/hooks/useAuth.tsx` | 수정 | R2-E: 블록 eslint 주석 → eslint-disable-next-line (범위 최소화) |
| `src/__tests__/hooks/useEmployeeManager.test.ts` | 수정 | mock에 getPreRegisteredEmployees 등 신규 함수 추가, 불필요한 firebase/firestore mock 제거 |

### 검증 결과

```
npm run lint   → ✅ 0 errors, 0 warnings
npx tsc --noEmit → ✅ 통과 (오류 없음)
npm run build  → ✅ 1669 modules, 예산 이내 (2949.3KB)
npm test --run → ✅ 43 files, 306 tests 전원 통과
```

## 2. Logic Chain

1. **R1**: 컴포넌트·훅에서 직접 `firebase/firestore` API(`addDoc`, `getDocs`, `deleteDoc`, `updateDoc`)를 호출하던 코드 → `lib/firestore/` 모듈 내 함수로 이동 후 import.
   - `useEmployeeManager`: preRegistered 서브컬렉션 CRUD → `preRegistered.ts` 신규 모듈
   - `AuthGuard`, `OrgMapView`, `DashboardOrgTable`: updateDoc → `clearUserOrganization`/`updateOrganization` 래퍼

2. **R2**: `useEffect` 의존성 배열 불일치로 인한 `react-hooks/exhaustive-deps` 경고 해소
   - fetchData/loadFavorites를 `useCallback(fn, [orgId])` 래핑 → `useEffect([fetchData])` 패턴
   - `useAuth.tsx`: 의도적 빈 의존성 배열(`[]`)이라 `eslint-disable-next-line`으로 범위 최소화

3. **R3**: IIFE 패턴으로 계산하던 `modelSuggestions` → `useMemo([vehicles])` 교체, 불필요한 재계산 방지

4. **R4**: 하드코딩된 `'https://vehicle-drive-log.web.app'` → `APP_URL` 상수 참조

5. **테스트 mock 업데이트**: 코드 리팩토링으로 새 함수가 추가되었으므로, 기존 mock 객체에 동일 이름의 mock 함수를 추가. assertion(기대값)은 변경 없음.

## 3. Caveats

- `useAuth.tsx`의 `eslint-disable-next-line`은 의도적 빈 의존성 배열을 유지하기 위함. `loading`을 의존성에 추가하면 auth 초기화 로직이 반복 실행될 수 있어 부작용 발생 가능.
- `firestore-rules.test.ts`는 Firebase 에뮬레이터 미실행으로 자동 skip 처리됨 (이번 변경과 무관, 기존 동일 동작).
- `useRetry`, `useSettings` 등에서 `act()` 경고가 stdout에 출력되나 테스트는 통과함 (기존 이슈, 이번 변경과 무관).

## 4. Conclusion

R1~R4 리팩토링 4개 작업 모두 완료. 자동 교정 루프(lint → tsc → build → test) 전 구간 통과.
- D9 위반(컴포넌트 내 직접 Firestore 호출) 완전 제거
- `react-hooks/exhaustive-deps` eslint 블록 주석 모두 제거 또는 최소화
- IIFE → useMemo 교체로 불필요한 재계산 방지
- 하드코딩 URL 상수화로 유지보수성 향상

## 5. Verification Method

```powershell
cd d:\apps\차량운행일지

# 1. lint 검증
npm run lint
# 기대: ✖ 0 problems (0 errors, 0 warnings)

# 2. TypeScript 검증
npx tsc --noEmit
# 기대: 출력 없음 (오류 없음)

# 3. 빌드 검증
npm run build
# 기대: ✓ built in X.XXs

# 4. 테스트 검증
npm test -- --run
# 기대: Test Files 43 passed (43), Tests 306 passed (306)

# 5. Firestore 직접 호출 잔존 확인 (결과 없어야 함)
grep -r "from 'firebase/firestore'" src/hooks/
grep -r "from 'firebase/firestore'" src/components/
grep -r "from '../../lib/firebase'" src/hooks/
grep -r "from '../../lib/firebase'" src/components/auth/
```

**무효화 조건**: lint 에러, tsc 오류, 테스트 실패 발생 시.
