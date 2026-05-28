# useOrgApplication Auth-Form 상태 동기화 분석 및 개선 보고서

## 1. 개요 및 요약
`src/hooks/useOrgApplication.ts` 훅은 기관 사용 신청 폼(/apply)의 입력 상태와 검증, 제출을 관리하는 핵심 훅입니다. 하지만 현재 구현에서는 **Firebase Auth의 비동기 인증 상태 변화를 실시간으로 감지하지 못하고**, 최초 마운트 시의 정적 상태만 복사하여 사용함으로써 **로그인 사용자의 정보가 폼에 동적으로 동기화되지 않거나, `readOnly` 속성이 정상 작동하지 않는 심각한 버그**가 존재합니다.

본 보고서에서는 해당 버그의 구체적인 원인을 분석하고, 이를 완전히 해결하여 동적 동기화를 보장하는 보완 구조 및 구체적인 소스코드 개선 패치를 제안합니다.

---

## 2. 문제점 및 버그 상세 분석

### ① 정적 `firebaseAuth.currentUser` 참조 문제
- **코드 위치**: `src/hooks/useOrgApplication.ts` Line 61
  ```typescript
  61:     const currentUser = firebaseAuth.currentUser;
  ```
- **원인 분석**: 
  - `firebaseAuth.currentUser`는 Firebase SDK가 초기화되고 토큰 세션을 복원하기 전(즉, 초기 렌더링 시점)에는 `null`입니다.
  - 이 변수는 단순한 static 값조회일 뿐 React의 **상태(State)가 아닙니다**. 따라서 Auth 세션이 복원되어 `currentUser` 객체가 실제로 생성되더라도 React는 이를 감지하지 못하며 리렌더링도 트리거되지 않습니다.

### ② `useState` 초기화에 의한 Auth 정보 반영 실패
- **코드 위치**: `src/hooks/useOrgApplication.ts` Line 64 ~ 70
  ```typescript
  64:     const [form, setForm] = useState({
  65:         applicantName: currentUser?.displayName || '',
  66:         orgName: '',
  67:         applicantEmail: currentUser?.email || '',
  68:         applicantPhone: '',
  69:         message: '',
  70:     });
  ```
- **원인 분석**:
  - `useState`는 컴포넌트 라이프사이클에서 **단 한 번, 마운트될 때만** 인자로 전달된 초기값을 평가하여 상태를 생성합니다.
  - 마운트 시점에 `currentUser`가 `null`이었다면 `applicantName`과 `applicantEmail`은 빈 문자열(`''`)로 고정됩니다. 이후 다른 상태 변경으로 인해 리렌더링이 수행되더라도 `useState` 초기값은 다시 평가되지 않으므로, 로그인한 사용자의 정보가 절대 자동으로 바인딩되지 않는 현상이 발생합니다.

### ③ UI 단의 `readOnly` 동적 적용 불가
- **코드 위치**: `src/components/auth/OrgApplicationPage.tsx` Line 96
  ```typescript
  96: ... className={`input ${currentUser?.email ? 'bg-surface-50 dark:bg-surface-800' : ''}`} readOnly={!!currentUser?.email} ...
  ```
- **원인 분석**:
  - `OrgApplicationPage` 역시 `useOrgApplication`으로부터 정적인 `currentUser`를 넘겨받아 사용하고 있습니다. 
  - Auth 로딩 완료로 인해 실제 로그인이 되어 있더라도 `currentUser`가 상태로서 갱신되지 못하므로, 이메일 필드는 비로그인용 수동 입력 모드(`readOnly={false}`)로 유지되거나 UI가 불일치 상태에 빠집니다.

### ④ UI 단의 이름 필드(`applicantName`) `readOnly` 누락 버그
- **코드 위치**: `src/components/auth/OrgApplicationPage.tsx` Line 85 ~ 91
  ```typescript
  85:                         <div>
  86:                             <label className="label">이름 <span className="text-red-500">*</span></label>
  87:                             <input
  88:                                 type="text" name="applicantName" value={form.applicantName}
  89:                                 onChange={handleChange} className="input" placeholder="홍길동" required
  90:                                 autoFocus
  91:                             />
  92:                         </div>
  ```
- **원인 분석**:
  - `PROJECT.md` 내 인터페이스 계약에 따르면 `applicantName` 역시 **"로그인 시 displayName 자동 바인딩 및 readOnly 처리"**가 수행되어야 합니다.
  - 하지만 현재 UI 코드상에는 이름 필드에 대한 `readOnly` 적용 및 로그인 시 비활성화 스타일(`bg-surface-50`)이 완전히 누락되어 로그인 상태에서도 사용자가 이름을 수정할 수 있게 방치되어 있습니다.

---

## 3. 해결 및 개선 방안 (구조 설계)

1. **`useAuth` 훅을 통한 반응형 Auth 상태 구독**:
   - `firebaseAuth.currentUser` 대신 프로젝트의 공통 인증 상태 관리 훅인 `useAuth()`를 호출합니다.
   - `useAuth()`가 제공하는 `user`와 `loading` 상태는 React state이므로, 비동기 세션 복원 시 자동으로 감지되어 훅 및 하위 컴포넌트를 즉각 리렌더링시킵니다.

2. **`useEffect`를 이용한 Auth ↔ Form 상태 동적 동기화**:
   - `authLoading`이 `false`가 되는 시점에 `user` 객체의 유무에 따라 폼의 신청자 정보를 실시간으로 강제 업데이트하는 사이드 이펙트를 구성합니다.
   - 이를 통해 최초 마운트 이후에 비동기로 로드된 사용자 정보가 안전하게 폼에 안착됩니다.

3. **로그아웃/로그인 교차 반응 및 클린업**:
   - 만약 세션 만료 등으로 로그아웃된 경우, 폼에 들어있던 사용자 이름과 이메일을 다시 빈 문자열로 리셋하여 비로그인 사용자가 자유롭게 입력할 수 있도록 상태를 비워줍니다.

---

## 4. 제안하는 Proposed Patch (코드 패치안)

### ① `useOrgApplication.ts` 개선 패치

```typescript
// Before
import { useState, useRef, useCallback } from 'react';
import { auth as firebaseAuth, firebaseFunctions } from '../lib/firebase';

// After
import { useState, useRef, useCallback, useEffect } from 'react';
import { firebaseFunctions } from '../lib/firebase';
import { useAuth } from './useAuth'; // useAuth 임포트
```

#### 구체적인 상태 및 동기화 구현부 제안:
```typescript
export default function useOrgApplication() {
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const { user: currentUser, loading: authLoading } = useAuth(); // useAuth에서 실시간 상태 구독

    // 폼 상태 (초기값은 currentUser 기준으로 하되, useEffect에서 완벽히 보완됨)
    const [form, setForm] = useState({
        applicantName: currentUser?.displayName || '',
        orgName: '',
        applicantEmail: currentUser?.email || '',
        applicantPhone: '',
        message: '',
    });
    
    // Auth 상태가 비동기적으로 로딩 완료되거나 상태가 변경될 때 동적으로 form을 동기화
    useEffect(() => {
        if (authLoading) return;

        if (currentUser) {
            setForm(prev => ({
                ...prev,
                applicantName: currentUser.displayName || '',
                applicantEmail: currentUser.email || '',
            }));
        } else {
            // 비로그인 상태일 때는 로그인 데이터 초기화 (기존 입력한 사항이 있다면 리셋하여 비로그인 폼 활성화)
            setForm(prev => ({
                ...prev,
                applicantName: '',
                applicantEmail: '',
            }));
        }
    }, [currentUser, authLoading]);

    // ... 기존 상태 유지 ...
```

---

### ② `OrgApplicationPage.tsx` 개선 패치 (인터페이스 계약 준수 보완)

이름 필드가 로그인 시 `readOnly` 처리되도록 UI 단도 보완되어야 합니다.

```typescript
// Before (Name Input)
<div>
    <label className="label">이름 <span className="text-red-500">*</span></label>
    <input
        type="text" name="applicantName" value={form.applicantName}
        onChange={handleChange} className="input" placeholder="홍길동" required
        autoFocus
    />
</div>

// After (Name Input - readOnly 및 스타일 조건부 적용 추가)
<div>
    <label className="label">이름 <span className="text-red-500">*</span></label>
    <input
        type="text" name="applicantName" value={form.applicantName}
        onChange={handleChange} 
        className={`input ${currentUser?.displayName ? 'bg-surface-50 dark:bg-surface-800 text-surface-500' : ''}`} 
        readOnly={!!currentUser?.displayName}
        placeholder="홍길동" required
        autoFocus={!currentUser?.displayName}
    />
</div>
```

---

## 5. 추가 보완 및 권장 사항

1. **제출 성공 시 상태 완전 초기화**:
   - `success`가 완료된 후 사용자가 홈 화면으로 나가거나 다른 동작을 처리할 때, 폼 내부 상태(`imageFile`, `imagePreview` 등)를 클린업해주는 보완 처리가 훅 내부에 들어가면 이상적입니다.
   
2. **테스트 코드 보완 (`useOrgApplication.test.ts`)**:
   - 현재 테스트 코드에는 `formatPhoneNumber` 유틸 함수의 단위 테스트만 존재합니다.
   - `react-hooks-testing-library`를 이용하여 `useOrgApplication` 훅이 마운트된 후 Auth 상태 변경에 따라 `form` 값이 정확히 연동 및 동기화되는지 검증하는 훅 단위 테스트 스펙 추가를 적극 권장합니다.
