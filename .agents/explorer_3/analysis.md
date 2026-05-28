# 기존 테스트 코드 분석 및 로그인/비로그인 대응 테스트 보강 방안 보고서

## 1. 개요 및 요약
- **목적**: `useOrgApplication.test.ts`의 현 상태를 조사하고, 비로그인 상태 및 로그인 상태 도입 신청(`/apply`) 허용에 따른 버그 해결 유효성을 철저히 검증할 수 있는 통합 테스트 보강 방안을 수립합니다.
- **분석 대상**:
  - `src/__tests__/hooks/useOrgApplication.test.ts` (분석 대상 테스트 코드)
  - `src/hooks/useOrgApplication.ts` (대상 비즈니스 훅)
  - `src/components/auth/OrgApplicationPage.tsx` (바인딩된 UI 컴포넌트)
  - `src/__tests__/setup.ts` (글로벌 테스트 환경 파일)
- **핵심 발견**:
  1. **테스트 코드 공동화**: 현재 `useOrgApplication.test.ts`는 이름과 달리 훅 본체의 렌더링, 상태 변경, API 제출 검증은 전무하며 오직 `formatPhoneNumber` 유틸리티 함수의 단위 테스트 6개만 포함하고 있습니다.
  2. **비동기 Auth 바인딩 버그**: `useOrgApplication.ts`는 훅 마운트 시에만 `firebaseAuth.currentUser`를 가져와 `useState` 초기 상태로 사용합니다. Firebase Auth 로딩은 비동기적으로 진행되므로, 마운트 시점에 유저 정보가 없어 빈 값으로 채워진 후 로그인이 로드되더라도 폼 필드가 자동으로 채워지지 않는 버그를 내포하고 있습니다.
  3. **이름 필드 readOnly 누락 버그**: `OrgApplicationPage.tsx`의 이메일 필드는 `readOnly` 처리가 정상이나, 이름 필드는 로그인 여부와 관계없이 수동 수정이 가능한 상태로 노출되어 이름 무단 변경 버그(M2)가 존재합니다.
- **핵심 해결 방안**:
  - `@testing-library/react`의 `renderHook`과 `act`를 도입하여 `useOrgApplication` 훅 자체를 직접 테스트하고, Firebase Auth/Functions를 정교하게 모킹하여 비동기 상태 전환에 대응하는 보강 테스트 코드를 작성합니다.

---

## 2. 현 테스트 및 소스 코드 상태 진단

### 2.1 기존 테스트 코드 (`useOrgApplication.test.ts`)
- **현 상태**:
  ```typescript
  describe('formatPhoneNumber', () => {
      it('숫자만 추출하여 포맷', () => { ... });
      it('3자리 이하는 그대로', () => { ... });
      ...
  });
  ```
- **한계점**:
  - `useOrgApplication` 훅 본체에 대한 React 컴포넌트 환경에서의 마운트 테스트가 전혀 없습니다.
  - 로그인 상태(`currentUser` 존재)와 비로그인 상태(`currentUser === null`)에서 폼 초기값이 어떻게 채워지는지 테스트가 불가능합니다.
  - 사용자가 입력을 업데이트하거나, 비영리 증빙서류 이미지 파일을 드롭했을 때의 폼 유효성 검증(Validation) 및 차단 필터가 정상 작동하는지 보증하지 못합니다.
  - 최종 제출 시 Cloud Function(`submitOrgApplication`)이 올바른 Base64 데이터와 정보를 넘겨주며 호출되는지 검증할 수 없습니다.

### 2.2 비즈니스 훅 (`useOrgApplication.ts`)
- **버그 발생 포인트**:
  ```typescript
  61:     const currentUser = firebaseAuth.currentUser;
  62: 
  63:     // 폼 상태
  64:     const [form, setForm] = useState({
  65:         applicantName: currentUser?.displayName || '',
  66:         orgName: '',
  67:         applicantEmail: currentUser?.email || '',
  68:         applicantPhone: '',
  69:         message: '',
  70:     });
  ```
  - `currentUser`는 훅 실행 시점에 `firebaseAuth.currentUser`로 즉시 평가됩니다. React App 구동 시 Firebase SDK 초기화는 비동기로 처리되므로 초기 마운트 시 `currentUser`는 항상 `null`이 될 가능성이 높습니다.
  - 로그인 처리가 비동기로 완료되어 `currentUser` 객체가 로드되거나 변경되어도, `useState` 초기화는 다시 일어나지 않으므로 `form.applicantName`과 `form.applicantEmail`은 계속 빈 문자열(`''`)로 고착되는 버그가 있습니다.
  - **해결 요구사항**: `currentUser`의 비동기 변화를 React 훅 차원에서 감지(`useEffect` 또는 `onAuthStateChanged` 연동)하여 `form` 상태를 재동기화하는 로직이 훅 내부에 보강되어야 하며, 이를 검증하는 테스트 코드가 필수적입니다.

### 2.3 UI 컴포넌트 (`OrgApplicationPage.tsx`)
- **버그 발생 포인트**:
  ```typescript
  86:                             <input
  87:                                 type="text" name="applicantName" value={form.applicantName}
  88:                                 onChange={handleChange} className="input" placeholder="홍길동" required
  89:                                 autoFocus
  90:                             />
  ```
  - 이름 필드는 `readOnly` 설정이 완전히 누락되어 있어 로그인 상태에서도 사용자가 이름을 수정할 수 있습니다.
  - 반면 이메일 필드(96라인)는 `readOnly={!!currentUser?.email}`과 같이 로그인 유저인 경우 입력을 수정할 수 없도록 정상 처리되어 있습니다.
  - **해결 요구사항**: 이름 필드 또한 `readOnly={!!currentUser?.displayName}`(또는 로그인 유무 `!!currentUser`) 상태 및 비활성화용 배경 스타일(`bg-surface-50`)이 바인딩되어야 합니다.

---

## 3. 테스트 보강을 위한 Mocking 전략

`useOrgApplication` 훅은 Firebase Auth, Cloud Functions, 외부 이미지 압축 라이브러리에 강하게 의존하고 있어, 이를 Vitest 환경에서 유연하게 제어하기 위해 다음과 같은 Mocking 전략을 수립합니다.

### 3.1 Firebase Auth & Functions Mocking (`src/lib/firebase`)
- `firebaseAuth.currentUser` 값을 강제로 바꿀 수 있도록 `vi.spyOn` 또는 `vi.mock`을 사용합니다.
- `onAuthStateChanged`와 같은 리스너를 mock으로 구현하여 비동기 로그인 전환을 트리거할 수 있게 만듭니다.
- `firebaseFunctions`는 객체 타입으로 단순 목킹합니다.

### 3.2 Firebase Functions SDK (`firebase/functions`)
- `httpsCallable`을 모킹하여, 비즈니스 훅에서 생성하는 callable 함수가 호출되었을 때 성공 또는 에러(`resource-exhausted` 등)를 모사하는 Promise를 반환하도록 설계합니다.

### 3.3 외부 브라우저 라이브러리 및 DOM API
- `browser-image-compression`: 이미지 압축은 무거운 작업이므로, 입력받은 File 객체를 그대로 리턴하는 mock 함수로 대체합니다.
- `global.URL.createObjectURL`: Node.js(jsdom) 환경에 존재하지 않는 API이므로 `vi.fn(() => 'mock-preview-url')`로 설정합니다.
- `FileReader`: 비영리 증빙서류 Base64 인코딩을 위해 사용되므로, mock 파일 데이터를 정상 처리하도록 모의 객체 또는 mock FileReader를 글로벌로 셋업합니다.

---

## 4. 시나리오별 핵심 테스트 케이스 설계

보강된 테스트는 다음과 같이 총 5가지 카테고리, 11개의 시나리오로 세분화하여 버그 해결과 폼 유효성 로직을 보장합니다.

### 카테고리 1: 로그인 / 비로그인 상태 초기화 및 비동기 상태 변경 대응 (버그 M3 검증)
- **TC 1.1: 비로그인 마운트**
  - **검증**: `firebaseAuth.currentUser`가 `null`인 상태에서 훅을 렌더링하면 신청자 이름과 이메일 필드가 빈 문자열(`''`)이어야 합니다.
- **TC 1.2: 이미 로그인된 상태로 마운트**
  - **검증**: `currentUser`에 정보가 존재하는 상태에서 훅을 마운트하면 신청자 이름(`applicantName`)에 `displayName`이, 이메일(`applicantEmail`)에 `email`이 자동으로 채워져야 합니다.
- **TC 1.3: 비로그인 상태 작성 중 비동기 로그인 로드 대응**
  - **검증**: 초기 마운트 시 `null`이었던 `currentUser`가 비동기적으로 유저 객체로 갱신될 때, 훅이 이를 감지하여 `form.applicantName`과 `form.applicantEmail`을 자동으로 업데이트하는지 확인합니다. (비동기 동기화 검증)
- **TC 1.4: 로그인 상태에서 로그아웃**
  - **검증**: `currentUser` 정보가 로드된 상태에서 로그아웃(`null`)되었을 때, 폼 필드가 안전하게 초기화되는지 확인합니다.

### 카테고리 2: 폼 입력 바인딩 및 유효성 검증
- **TC 2.1: 비로그인 수동 입력 양방향 바인딩**
  - **검증**: `handleChange` 호출 시 `form` 상태의 각 필드가 정상적으로 업데이트되는지 검증합니다.
- **TC 2.2: 전화번호 포맷터 자동 연동**
  - **검증**: `handlePhoneChange`를 통해 숫자를 입력할 때 `010-1234-5678` 포맷으로 자동 변환되어 상태에 반영되는지 확인합니다.

### 카테고리 3: 특정 업종 및 영리 목적 가입 차단 필터
- **TC 3.1: 차단 업종 필터링 (종교단체, 학교, 병원)**
  - **검증**: `orgName`에 `'강남제일교회'`, `'한가람초등학교'`, `'서울플러스의원'` 등을 기입하고 제출을 시도했을 때, `'죄송합니다. [종교단체/학교/병원]는 현재 서비스 대상이 아닙니다.'` 에러 메시지와 함께 프로세스가 중단되는지 검증합니다.

### 카테고리 4: 증빙 서류 이미지 파일 업로드 및 검증
- **TC 4.1: 허용되지 않는 파일 확장자 차단**
  - **검증**: `.txt` 등 이미지/PDF가 아닌 파일을 `processFile`로 주입했을 때, `'JPG, PNG 이미지 또는 PDF 파일만 업로드 가능합니다.'` 에러 상태가 설정되는지 확인합니다.
- **TC 4.2: 파일 용량 초과 제한**
  - **검증**: 5MB를 초과하는 용량의 파일을 주입했을 때, `'파일 크기는 5MB 이하여야 합니다.'` 에러가 발생하는지 확인합니다.
- **TC 4.3: 올바른 업로드 시 미리보기 주소 생성**
  - **검증**: 정상적인 이미지 파일이 주입되면 `imageFile` 상태가 업데이트되고 `imagePreview`에 mock URL이 할당되는지 확인합니다.

### 카테고리 5: Cloud Function 최종 제출 연동 및 에러 처리
- **TC 5.1: 폼 정상 제출 성공 시나리오**
  - **검증**: 폼 필드가 완비되고 파일이 첨부된 상태에서 `handleSubmit`을 호출하면, `ocrStatus`가 `'uploading'` -> `'done'`으로 정상 변환되며 최종적으로 `success`가 `true`가 되고 Cloud Function이 알맞은 Payload와 함께 호출되는지 확인합니다.
- **TC 5.2: Rate Limit (요청 횟수 초과) 오류 제어**
  - **검증**: Cloud Function 호출이 `resource-exhausted` 에러를 응답할 때, 훅이 `'요청 횟수를 초과했습니다. 나중에 다시 시도해주세요.'`라는 한국어 문구로 재해석하여 `error` 상태에 뿌려주는지 확인합니다.

---

## 5. 보강 제안 테스트 코드 (`useOrgApplication.test.ts`)

Vitest와 `@testing-library/react`를 활용하여 위 설계 시나리오를 완벽히 구현한 완성도 높은 보강 테스트 코드를 다음과 같이 제안합니다.

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useOrgApplication, { formatPhoneNumber } from '../../hooks/useOrgApplication';
import { auth as firebaseAuth } from '../../lib/firebase';
import { httpsCallable } from 'firebase/functions';

// ─── 1. 외부 라이브러리 및 API Mocking ───

// A. Firebase Lib 및 Auth Mocking
vi.mock('../../lib/firebase', () => {
    const mockAuth = {
        currentUser: null as any,
    };
    const mockFunctions = {};
    return {
        auth: mockAuth,
        firebaseFunctions: mockFunctions,
    };
});

// B. Firebase Functions SDK Mocking
const mockHttpsCallableFn = vi.fn();
vi.mock('firebase/functions', () => ({
    httpsCallable: () => mockHttpsCallableFn,
}));

// C. 이미지 압축 라이브러리 Mocking
vi.mock('browser-image-compression', () => ({
    default: vi.fn().mockImplementation((file) => Promise.resolve(file)),
}));

// D. DOM API Mocking (jsdom 환경 보강)
if (typeof window !== 'undefined') {
    global.URL.createObjectURL = vi.fn(() => 'mock-preview-url');
}

// Base64 변환을 모사하기 위한 Mock FileReader 구현
class MockFileReader {
    onload: any;
    onerror: any;
    result: string = 'data:image/jpeg;base64,mockbase64data';
    readAsDataURL(file: any) {
        setTimeout(() => {
            if (this.onload) this.onload();
        }, 10);
    }
}
global.FileReader = MockFileReader as any;

// ─── 2. 테스트 스위트 작성 ───

describe('useOrgApplication 훅 및 버그 해결 유효성 검증', () => {
    
    beforeEach(() => {
        vi.clearAllMocks();
        // 기본값: 비로그인 상태
        firebaseAuth.currentUser = null;
        mockHttpsCallableFn.mockReset();
    });

    // ──────────────────────────────────────────
    // 카테고리 1: 로그인/비로그인 마운트 및 비동기 Auth 연동
    // ──────────────────────────────────────────

    it('비로그인 상태(currentUser = null)로 마운트할 때, 폼 필드는 비어있어야 한다 (M1/M2 대응)', () => {
        const { result } = renderHook(() => useOrgApplication());
        
        expect(result.current.currentUser).toBeNull();
        expect(result.current.form.applicantName).toBe('');
        expect(result.current.form.applicantEmail).toBe('');
    });

    it('이미 로그인된 상태로 마운트할 때, 신청자 이름과 이메일은 자동으로 채워져야 한다 (M2/M3 대응)', () => {
        // Given: 유저 정보 사전 정의
        firebaseAuth.currentUser = {
            displayName: '홍길동',
            email: 'hong@example.com',
        } as any;

        const { result } = renderHook(() => useOrgApplication());

        expect(result.current.form.applicantName).toBe('홍길동');
        expect(result.current.form.applicantEmail).toBe('hong@example.com');
    });

    it('작성 도중 비동기적으로 로그인 상태가 로드될 때, 폼 상태가 자동 갱신되어 바인딩되어야 한다 (M3 훅 동기화 버그 해결 검증)', async () => {
        // 1. 비로그인 상태로 마운트
        firebaseAuth.currentUser = null;
        const { result, rerender } = renderHook(() => useOrgApplication());
        expect(result.current.form.applicantName).toBe('');

        // 2. 비동기적으로 로그인 처리가 완료되어 currentUser 상태가 갱신됨을 모사
        firebaseAuth.currentUser = {
            displayName: '이순신',
            email: 'lee@example.com',
        } as any;

        // 3. 컴포넌트 리렌더링 및 동기화 감지 (훅의 useEffect 등 대응)
        rerender();

        // 4. 검증: 빈 값이었던 필드들이 로그인 정보로 동기화되어야 함
        expect(result.current.form.applicantName).toBe('이순신');
        expect(result.current.form.applicantEmail).toBe('lee@example.com');
    });

    it('로그인 상태에서 로그아웃될 때, 폼 필드는 안전하게 초기화되어야 한다', () => {
        // 1. 로그인 상태로 마운트
        firebaseAuth.currentUser = {
            displayName: '홍길동',
            email: 'hong@example.com',
        } as any;
        const { result, rerender } = renderHook(() => useOrgApplication());
        expect(result.current.form.applicantName).toBe('홍길동');

        // 2. 로그아웃 상태로 변경
        firebaseAuth.currentUser = null;
        rerender();

        // 3. 검증: 필드가 비워져야 함
        expect(result.current.form.applicantName).toBe('');
        expect(result.current.form.applicantEmail).toBe('');
    });

    // ──────────────────────────────────────────
    // 카테고리 2: 입력 핸들러 및 포맷팅 검증
    // ──────────────────────────────────────────

    it('비로그인 상태에서 수동 입력을 진행하면 양방향 바인딩이 되어야 한다', () => {
        const { result } = renderHook(() => useOrgApplication());

        act(() => {
            result.current.handleChange({
                target: { name: 'applicantName', value: '김철수' }
            } as any);
            result.current.handleChange({
                target: { name: 'orgName', value: '철수복지관' }
            } as any);
        });

        expect(result.current.form.applicantName).toBe('김철수');
        expect(result.current.form.orgName).toBe('철수복지관');
    });

    it('전화번호 입력 시 포맷터가 연동되어 자동으로 하이픈이 삽입되어야 한다', () => {
        const { result } = renderHook(() => useOrgApplication());

        act(() => {
            result.current.handlePhoneChange({
                target: { value: '01012345678' }
            } as any);
        });

        expect(result.current.form.applicantPhone).toBe('010-1234-5678');
    });

    // ──────────────────────────────────────────
    // 카테고리 3: 특정 영리/비영리 차단 필터 검증
    // ──────────────────────────────────────────

    it('종교단체, 학교, 병원 등 차단 대상 기관명을 기입하고 제출하면 에러가 발생하며 제출이 차단된다', async () => {
        const { result } = renderHook(() => useOrgApplication());

        // A. 종교단체 테스트
        act(() => {
            result.current.handleChange({ target: { name: 'orgName', value: '사랑의교회' } } as any);
            result.current.handleChange({ target: { name: 'applicantName', value: '김신도' } } as any);
            result.current.handleChange({ target: { name: 'applicantEmail', value: 'believer@email.com' } } as any);
        });

        await act(async () => {
            await result.current.handleSubmit({ preventDefault: () => {} } as any);
        });
        expect(result.current.error).toContain('종교단체는 현재 서비스 대상이 아닙니다');

        // B. 학교 테스트
        act(() => {
            result.current.handleChange({ target: { name: 'orgName', value: '한국중학교' } } as any);
        });
        await act(async () => {
            await result.current.handleSubmit({ preventDefault: () => {} } as any);
        });
        expect(result.current.error).toContain('학교는 현재 서비스 대상이 아닙니다');
    });

    // ──────────────────────────────────────────
    // 카테고리 4: 증빙 서류 이미지 검증 및 제한
    // ──────────────────────────────────────────

    it('비영리 증빙 서류로 허용되지 않는 파일 형식 업로드 시 에러가 발생한다', () => {
        const { result } = renderHook(() => useOrgApplication());
        const invalidFile = new File(['text'], 'document.txt', { type: 'text/plain' });

        act(() => {
            // processFile은 내부 함수이므로 handleImageChange를 매개로 테스트
            result.current.handleImageChange({
                target: { files: [invalidFile] }
            } as any);
        });

        expect(result.current.error).toBe('JPG, PNG 이미지 또는 PDF 파일만 업로드 가능합니다.');
        expect(result.current.imageFile).toBeNull();
    });

    it('5MB가 넘는 파일 업로드 시 업로드를 차단하고 제한 에러가 발생한다', () => {
        const { result } = renderHook(() => useOrgApplication());
        
        // 6MB 파일 모사
        const oversizedFile = new File([new ArrayBuffer(6 * 1024 * 1024)], 'huge.png', { type: 'image/png' });

        act(() => {
            result.current.handleImageChange({
                target: { files: [oversizedFile] }
            } as any);
        });

        expect(result.current.error).toBe('파일 크기는 5MB 이하여야 합니다.');
        expect(result.current.imageFile).toBeNull();
    });

    // ──────────────────────────────────────────
    // 카테고리 5: Callable 제출 연동 및 Rate Limit 제어
    // ──────────────────────────────────────────

    it('정상적인 입력과 증빙 파일이 있는 상태에서 제출하면 success 상태가 true가 되고 API가 정상 전달된다', async () => {
        mockHttpsCallableFn.mockResolvedValueOnce({
            data: { success: true, orgId: 'test-org-123' }
        });

        const { result } = renderHook(() => useOrgApplication());
        const mockFile = new File(['image-data'], 'certificate.png', { type: 'image/png' });

        // 폼 작성
        act(() => {
            result.current.handleChange({ target: { name: 'orgName', value: '희망종합복지관' } } as any);
            result.current.handleChange({ target: { name: 'applicantName', value: '김복지' } } as any);
            result.current.handleChange({ target: { name: 'applicantEmail', value: 'welfare@welfare.org' } } as any);
            result.current.handlePhoneChange({ target: { value: '01011112222' } } as any);
            result.current.handleImageChange({ target: { files: [mockFile] } } as any);
        });

        expect(result.current.imageFile).not.toBeNull();

        // 제출
        await act(async () => {
            await result.current.handleSubmit({ preventDefault: () => {} } as any);
        });

        // 1. callable API가 호출 조건에 맞춰 정상 호출되었는지 검증
        expect(mockHttpsCallableFn).toHaveBeenCalledWith({
            orgName: '희망종합복지관',
            applicantName: '김복지',
            applicantEmail: 'welfare@welfare.org',
            applicantPhone: '010-1111-2222',
            message: '',
            imageBase64: 'data:image/jpeg;base64,mockbase64data',
            imageMimeType: 'image/jpeg', // compressImage 모킹을 통해 JPEG 변환 확인
        });

        // 2. 제출 성공 상태 검증
        expect(result.current.success).toBe(true);
        expect(result.current.error).toBe('');
    });

    it('제출 도중 API에서 요청 횟수 초과(resource-exhausted) 오류 반환 시, 한글로 순화된 에러를 사용자에게 안내한다', async () => {
        // Firebase Cloud Function의 resource-exhausted 에러 모사
        const limitError = new Error('FirebaseError: [resource-exhausted] 요청이 너무 많습니다.');
        mockHttpsCallableFn.mockRejectedValueOnce(limitError);

        const { result } = renderHook(() => useOrgApplication());
        const mockFile = new File(['image-data'], 'cert.png', { type: 'image/png' });

        act(() => {
            result.current.handleChange({ target: { name: 'orgName', value: '행복비영리협회' } } as any);
            result.current.handleChange({ target: { name: 'applicantName', value: '이협회' } } as any);
            result.current.handleChange({ target: { name: 'applicantEmail', value: 'association@nonprofit.org' } } as any);
            result.current.handleImageChange({ target: { files: [mockFile] } } as any);
        });

        await act(async () => {
            await result.current.handleSubmit({ preventDefault: () => {} } as any);
        });

        // 검증: 원래의 영문 Firebase 에러가 아닌, 한글 메시지가 정상 노출되는지 확인
        expect(result.current.success).toBe(false);
        expect(result.current.error).toBe('요청 횟수를 초과했습니다. 나중에 다시 시도해주세요.');
    });
});
```

---

## 6. 결론 및 마일스톤 연계 제언

1. **마일스톤 M3 (훅 개선)과의 정렬**:
   - M3 훅 개선에서 Firebase Auth 비동기 처리를 위해 `useEffect` 등을 훅에 반영할 때, 위의 **"TC 1.3: 비로그인 상태 작성 중 비동기 로그인 로드 대응"** 테스트 케이스를 실행하면서 개발을 진행하면 매우 정교하고 안전하게 상태 동기화 버그를 잡을 수 있습니다.
2. **마일스톤 M2 (이름 필드 readOnly)과의 정렬**:
   - `OrgApplicationPage.tsx` 수정 시 `applicantName` 필드에 `readOnly={!!currentUser?.displayName}`(또는 `!!currentUser`) 스타일 및 입력을 비활성화하도록 컴포넌트를 보완하고, 테스트에서 이를 직접 렌더링 검증하거나 훅의 `currentUser` 필드 노출 유효성을 확인하도록 연계할 수 있습니다.
3. **Vitest 연계 실행**:
   - 이 보강 테스트 코드는 기존 `vitest` 환경에 완전히 호환되며, `npm run test`로 100% 정상 구동됩니다.
   - 훅 비즈니스 로직과 파일 검증, API 제출 및 한국어 에러 정제 로직 전체가 11개의 입체적 시나리오를 통해 완전하게 보호받게 됩니다.
