---
name: add-firestore-field
description: 기존 Firestore 컬렉션에 새 필드를 추가하고 타입·UI에 반영하는 패턴 가이드
---

# Firestore 필드 추가 스킬

기존 Firestore 컬렉션 문서에 새 필드를 추가할 때의 체크리스트.

## 작업 순서

### 1. 타입 정의 수정

`src/types/` 디렉터리에서 해당 도메인의 인터페이스를 찾아 필드를 추가한다.

```ts
// src/types/organization.ts 예시
export interface Organization extends FirestoreDoc {
    name: string;
    message?: string;  // ← 새 필드 (optional)
}
```

> 기존 데이터에는 이 필드가 없으므로 **반드시 optional(`?`)** 로 선언한다.

### 2. 데이터 저장 확인

`src/lib/firestore/` 또는 `src/hooks/` 에서 해당 필드를 Firestore에 저장하는 코드가 있는지 확인한다.

- 이미 저장하고 있는 경우 → 타입만 추가하면 됨
- 아직 저장하지 않는 경우 → 저장 로직 추가 필요 (스킬 `add-firestore-fn` 참고)

### 3. UI에 표시

컴포넌트에서 새 필드를 표시할 때의 패턴:

```tsx
{/* 조건부 렌더링: 필드가 있을 때만 표시 */}
{item.newField && (
    <div className="mt-2 px-3 py-2 rounded-lg bg-primary-50 dark:bg-primary-900/20 border border-primary-100 dark:border-primary-800 text-sm">
        <span className="text-xs font-medium text-primary-500 dark:text-primary-400">📝 라벨</span>
        <p className="text-surface-700 dark:text-surface-300 mt-0.5 whitespace-pre-wrap">{item.newField}</p>
    </div>
)}
```

### 4. 검증

```bash
npx tsc --noEmit  # 타입 에러 없는지 확인
```

## 체크리스트

- [ ] `src/types/` 인터페이스에 optional 필드 추가
- [ ] `src/lib/firestore/` 에서 저장 로직 확인/추가
- [ ] 표시할 컴포넌트에서 조건부 렌더링 추가
- [ ] 다크 모드 스타일 적용 (`dark:` 프리픽스)
- [ ] `tsc --noEmit` 통과

## 주의사항

1. **하위 호환성**: 기존 문서에는 새 필드가 없으므로 항상 `?.` 또는 `&&` 체크 필요
2. **Firestore 인덱스**: 새 필드로 쿼리/정렬한다면 `firestore.indexes.json`에 인덱스 추가
3. **Security Rules**: 새 필드에 대한 읽기/쓰기 권한이 기존 규칙으로 충분한지 확인
