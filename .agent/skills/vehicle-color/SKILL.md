---
name: vehicle-color
description: 차량 아이콘과 배경색을 일관성 있게 사용하는 가이드. 새 컴포넌트에서 차량을 표시할 때 반드시 참고.
---

# 차량 아이콘 & 배경색 통일 규칙

차량을 시각적으로 표시하는 모든 UI에서 **반드시** 아래 규칙을 따른다.
차량마다 고유한 색상을 유지해야 사용자가 직관적으로 차량을 식별할 수 있다.

## 핵심 유틸

```typescript
import { VEHICLE_TYPE_ICONS, getVehicleColor } from '../../lib/constants';
```

| 유틸 | 역할 | 예시 |
|------|------|------|
| `VEHICLE_TYPE_ICONS[vehicleType]` | 차종별 이모지 아이콘 | `'sedan'` → `🚗` |
| `getVehicleColor(vehicleId)` | 차량 ID 해시 기반 고유 배경색 | `'abc123'` → `'bg-red-200'` |

## 필수 사용 패턴

```tsx
const vehicle = getVehicleById(vehicleId);
const vehicleIcon = vehicle?.vehicleType
    ? (VEHICLE_TYPE_ICONS[vehicle.vehicleType] || '🚗')
    : '🚗';
const vehicleBg = vehicle
    ? getVehicleColor(vehicle.id)
    : 'bg-surface-200 dark:bg-surface-700';

<div className={`w-10 h-10 rounded-xl ${vehicleBg} flex items-center justify-center text-xl`}>
    {vehicleIcon}
</div>
```

## 금지 사항

- ❌ 배경색 하드코딩 (`bg-emerald-50`, `bg-indigo-50` 등)
- ❌ 아이콘 하드코딩 (`🚗`, `💳` 등 — vehicleType에서 가져와야 함)
- ❌ 차량이 아닌 다른 아이콘으로 대체 (💳 → 🚗)

## 체크리스트

새 컴포넌트에서 차량을 표시할 때:

1. `VEHICLE_TYPE_ICONS`와 `getVehicleColor`를 import 했는가?
2. 차량 ID로 `getVehicleColor(vehicle.id)`를 호출하는가? (하드코딩 금지)
3. 차량 타입으로 `VEHICLE_TYPE_ICONS[vehicle.vehicleType]`을 호출하는가?
4. 차량 정보가 없을 때 fallback 처리(`🚗`, `bg-surface-200`)가 있는가?
