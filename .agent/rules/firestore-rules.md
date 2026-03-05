---
description: Firestore & Storage 보안 규칙 수정 가이드. firestore.rules 또는 storage.rules를 수정할 때 반드시 참고한다.
---

# 🔒 Firestore & Storage 보안 규칙 가이드

이 문서는 `firestore.rules`와 `storage.rules`를 수정할 때 따라야 할 규칙이다.

---

## 1. Firestore Rules 구조

### 1.1 헬퍼 함수

현재 정의된 헬퍼 함수들을 **우선 재사용**한다:

| 함수 | 용도 |
|------|------|
| `isSignedIn()` | 로그인 여부 |
| `isSuperAdmin()` | 슈퍼관리자 (이메일 + role 체크) |
| `isOrgMember(orgId)` | 해당 기관 소속 여부 |
| `isOrgAdmin(orgId)` | 해당 기관의 관리자 여부 |
| `isOwner(uid)` | 자신의 문서 여부 |
| `userOrgId()` | 현재 사용자의 organizationId |
| `belongsToMyOrg()` | 기존 문서가 내 기관 소속인지 (`resource.data`) |
| `newBelongsToMyOrg()` | 새 문서가 내 기관 소속인지 (`request.resource.data`) |

### 1.2 역할 체계

| 역할 | Firestore `role` | 권한 범위 |
|------|------------------|-----------|
| 슈퍼관리자 | `superAdmin` | 전체 데이터 읽기/쓰기 |
| 기관관리자 | `admin` | 자기 기관의 데이터 읽기/쓰기 |
| 기관직원 | `employee` | 자기 기관의 데이터 읽기 + 제한적 쓰기 |

---

## 2. 새 컬렉션 규칙 추가 패턴

```
// === 컬렉션 이름 (한글) ===
match /collectionName/{docId} {
    allow read: if belongsToMyOrg() || isSuperAdmin();
    allow create: if newBelongsToMyOrg();
    allow update: if belongsToMyOrg() || isSuperAdmin();
    allow delete: if isSuperAdmin();
}
```

### 2.1 패턴별 선택 가이드

| 시나리오 | read | create | update | delete |
|---------|------|--------|--------|--------|
| 기관 공용 데이터 (차량, 예약 등) | `belongsToMyOrg()` | `newBelongsToMyOrg()` | `belongsToMyOrg()` | `isSuperAdmin()` |
| 관리자만 관리 (정비기록 등) | `belongsToMyOrg()` | `newBelongsToMyOrg() && isOrgAdmin(...)` | `isOrgAdmin(...)` | `isOrgAdmin(...)` |
| 개인 데이터 (즐겨찾기 등) | `resource.data.userId == request.auth.uid` | `request.resource.data.userId == request.auth.uid` | 소유자만 | 소유자만 |
| 시스템 데이터 | `isSignedIn()` | `false` | `false` | `false` |

### 2.2 서브컬렉션

```
match /parentCollection/{parentId} {
    // 부모 규칙...

    match /subCollection/{subId} {
        allow read: if isOrgMember(parentId);
        allow write: if isOrgAdmin(parentId) || isSuperAdmin();
    }
}
```

---

## 3. 핵심 원칙

### 3.1 조직 격리 (Multi-tenancy)

- **모든 기관 데이터** 규칙에 `organizationId` 기반 접근 제어 필수
- `belongsToMyOrg()`는 `resource.data.organizationId == userOrgId()`를 검증
- `newBelongsToMyOrg()`는 `request.resource.data.organizationId == userOrgId()`를 검증

### 3.2 SuperAdmin 와일드카드

`firestore.rules` 최상단에 SuperAdmin 전체 접근 규칙이 이미 존재한다. 이 규칙이 다른 모든 규칙보다 먼저 평가된다:

```
match /{document=**} {
    allow read, write: if isSuperAdmin();
}
```

> 따라서 개별 컬렉션 규칙에 `|| isSuperAdmin()`를 명시하지 않아도 SuperAdmin은 접근 가능하다. 다만 **가독성을 위해** 명시적으로 기술하는 것을 권장한다.

### 3.3 Firestore read 제한

- `get()` / `exists()` 호출은 보안 규칙 평가당 **최대 10회**까지만 허용된다
- 중첩된 `get()` 호출을 줄이기 위해 헬퍼 함수를 최대한 재사용한다

---

## 4. Storage Rules

`storage.rules` 파일의 기본 구조:

```
rules_version = '2';
service firebase.storage {
    match /b/{bucket}/o {
        match /{allPaths=**} {
            // 인증된 사용자만 읽기/쓰기
            allow read, write: if request.auth != null;
        }
    }
}
```

### 파일 업로드 제한 시 패턴:

```
match /uploads/{orgId}/{allPaths=**} {
    allow read: if request.auth != null;
    allow write: if request.auth != null
                 && request.resource.size < 10 * 1024 * 1024  // 10MB 제한
                 && request.resource.contentType.matches('image/.*|application/pdf');
}
```

---

## 5. 수정 후 검증

### 5.1 문법 검증

```bash
# Firebase CLI로 규칙 유효성 검사
firebase deploy --only firestore:rules --dry-run
```

### 5.2 배포

```bash
# Firestore + Storage 규칙만 배포 (/deploy-rules 워크플로우)
firebase deploy --only firestore:rules,storage
```

### 5.3 테스트 권장 사항

규칙 수정 후 다음 시나리오를 확인한다:
- ✅ 해당 역할의 사용자가 정상 접근 가능한지
- ✅ 다른 기관 사용자가 접근이 **차단**되는지
- ✅ 비로그인 사용자가 접근이 **차단**되는지

---

## 6. 주의사항

1. **규칙 순서**: Firestore Rules는 첫 번째로 매칭된 규칙이 적용되므로, 와일드카드 규칙의 위치에 주의한다
2. **인덱스**: 새 컬렉션에 복합 쿼리가 필요하면 `firestore.indexes.json`에 인덱스 추가
3. **배포 영향**: 규칙 변경은 **즉시 모든 사용자에게 적용**되므로, 신중하게 테스트 후 배포한다
4. **하드코딩 회피**: 슈퍼관리자 이메일을 제외하고, 특정 UID나 이메일을 하드코딩하지 않는다
