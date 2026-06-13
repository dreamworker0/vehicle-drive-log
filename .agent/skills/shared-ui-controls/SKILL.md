---
name: shared-ui-controls
description: 토글/스위치 등 공용 입력 컨트롤의 정석 패턴 가이드. 토글·스위치를 추가하거나 수정할 때, on/off 스위치 UI가 필요할 때 참고. 직접 마크업하지 말고 공용 컴포넌트를 사용한다.
---

# 공용 UI 컨트롤 스킬

토글/스위치 등 화면 전반에서 반복되는 입력 컨트롤은 **공용 컴포넌트로만** 사용한다.
같은 컨트롤을 파일마다 직접 마크업하면 크기·색·애니메이션이 어긋나고(실제로 토글이
원형으로 깨진 적이 있다), 접근성 속성이 누락된다.

---

## 1. 토글 스위치 — `Toggle`

**위치**: [src/components/common/Toggle.tsx](../../../src/components/common/Toggle.tsx)

on/off 스위치가 필요하면 **반드시 이 컴포넌트를 쓴다.** `inline-flex … rounded-full` +
`translate-x` knob 마크업을 새로 작성하지 않는다.

### 사용법

```tsx
import Toggle from '../common/Toggle';

// 기본 (primary 색)
<Toggle
    label="예약 관리자 승인"               // 옆에 보이는 텍스트 라벨이 없으면 필수 (aria-label)
    checked={form.requireReservationApproval}
    onChange={(next) => handleSave(null, { requireReservationApproval: next })}
/>

// 반전 값 (숨김 플래그를 표시 토글로 노출)
<Toggle
    label="PDF 결재란 표시"
    checked={!form.hideApprovalLine}
    onChange={(next) => setForm({ ...form, hideApprovalLine: !next })}
/>

// 의미상 다른 색이 필요할 때만 onClassName 지정 (예: 전기차 = emerald)
<Toggle label="전기차" checked={isElectric} onChange={setIsElectric} onClassName="bg-emerald-500" />

// 인자 없는 토글 핸들러도 그대로 연결 가능 (() => void 는 (next) => void 에 할당 가능)
<Toggle label="다크 모드" checked={isDark} onChange={toggleTheme} />
```

### Props

| prop | 타입 | 기본 | 설명 |
|---|---|---|---|
| `checked` | `boolean` | — | 켜짐 여부 |
| `onChange` | `(next: boolean) => void` | — | 변경될 다음 값을 인자로 받는다 |
| `label` | `string?` | — | 접근성 라벨. 옆에 보이는 텍스트가 없으면 **필수** |
| `onClassName` | `string?` | `'bg-primary-600'` | 켜짐 상태 트랙 배경색. 의미상 필요할 때만 변경 |
| `disabled` | `boolean?` | `false` | 비활성화 |

### 표준 규격 (컴포넌트 내부, 직접 바꾸지 말 것)

- 트랙: `h-7 w-12` / knob: `h-5 w-5` / 이동: `translate-x-3` ↔ `-translate-x-3`
- off 트랙: `bg-surface-200 dark:bg-surface-700`, knob: `bg-white shadow-md`
- 전환: `duration-300`
- 터치 영역: `before:absolute before:-inset-y-2.5` 가상요소로 48px 확보
  (트랙 자체를 `min-h-[48px]`로 키우면 정사각형이 되어 원형으로 깨진다 — 금지)

---

## 2. 새 공용 컨트롤을 추가할 때

체크박스·라디오·세그먼트 등 새 반복 컨트롤이 2곳 이상에서 필요해지면:

1. `src/components/common/`에 단일 컴포넌트로 추출한다.
2. `label`(접근성), `disabled`, 색상 override prop을 갖추되 **기본값으로 통일 규격**을 강제한다.
3. 이 SKILL.md에 사용법·Props·표준 규격 섹션을 추가한다.
4. 터치 타깃은 트랙 크기를 키우지 말고 `before:`/`after:` 가상요소로 확보한다.

---

## 체크리스트

- [ ] 토글이 필요한가? → `Toggle` 사용. 직접 마크업 금지.
- [ ] 옆에 보이는 텍스트 라벨이 없는가? → `label` 지정.
- [ ] on 색을 바꿔야 하나? → 의미가 있을 때만 `onClassName`. 기본은 primary 유지.
- [ ] 새 반복 컨트롤인가? → `common/`에 추출하고 이 문서에 추가.
