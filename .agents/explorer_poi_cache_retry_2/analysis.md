# 린트 결함 치유 분석 보고서 (analysis.md)

## 1. 개요 및 요약
- **목적**: 차량운행일지 PWA 서비스의 POI 검색 캐싱 개선 테스트 파일(`src/__tests__/hooks/usePoiSearch.test.ts`) 내에서 발생한 3건의 ESLint 린트 오류를 분석하고, TypeScript의 Strict Typing 원칙 및 에이전트 행동 헌법에 부합하는 완벽한 치유 가이드라인을 제공합니다.
- **요약**: 모킹된 API 함수의 매개변수 타입을 구체화하고, 테스트 모킹 데이터와 실제 `PoiResult` 타입 간 불일치 현상을 해결하기 위해 명확한 타입 정의 또는 모킹 데이터 규격화를 제안하며, 미사용 구조분해 변수를 제거하여 ESLint 에러를 100% 해소합니다.

---

## 2. 결함 및 원인 분석 (Evidence Chain)

### 결함 1: `mockSearchPOIList` 함수 인자 타입의 `any[]` 사용
- **위치**: `src/__tests__/hooks/usePoiSearch.test.ts:7`
- **코드**:
  ```typescript
  searchPOIList: (...args: any[]) => mockSearchPOIList(...args),
  ```
- **원인**: 외부 모듈 `searchPOIList`를 모킹하는 과정에서 모든 전달 인자를 가변 인자 `...args: any[]`로 처리하여 `@typescript-eslint/no-explicit-any` 위반이 발생했습니다.
- **분석 및 검증**:
  - `src/lib/tmap/geocoding.ts:39`를 확인해 보면, `searchPOIList` 함수는 다음과 같이 명확히 선언되어 있습니다.
    ```typescript
    export const searchPOIList = async (keyword: string, count = 5): Promise<PoiResult[]>
    ```
  - 또한, 테스트 코드 내에서의 호출 검증 식은 `expect(mockSearchPOIList).toHaveBeenCalledWith('서울시청', 10);` 형태입니다.
  - 따라서, 가변 `any[]` 대신 `keyword: string, count?: number`로 타입을 한정 지으면 `any` 없이 안전하게 모킹이 가능합니다.

### 결함 2: `initialData` 변수 타입의 `any` 사용
- **위치**: `src/__tests__/hooks/usePoiSearch.test.ts:89`
- **코드**:
  ```typescript
  const initialData: Record<string, any> = {};
  ```
- **원인**: FIFO 링 버퍼 테스트를 위해 50개의 캐시 데이터를 강제로 생성 및 적재하는 과정에서, `initialData` 객체의 값 타입을 `any`로 회피 지정하여 `@typescript-eslint/no-explicit-any` 위반이 발생했습니다.
- **근본 원인 (타입 불일치)**:
  - 실제 PWA 서비스 코드(`src/hooks/usePoiSearch.ts:24`)에 정의된 캐시 구조는 다음과 같습니다.
    ```typescript
    interface PoiCacheData {
        queue: string[];
        data: Record<string, PoiResult[]>;
    }
    ```
  - 그러나 테스트 코드 93라인에서는 다음과 같이 모킹 데이터를 밀어 넣고 있습니다.
    ```typescript
    initialData[kw] = [{ name: kw, latitude: 37, longitude: 126 }];
    ```
  - `PoiResult` 타입은 `lat: number; lon: number; name: string; address: string;` 구조이지만, 테스트 코드에서는 `latitude`, `longitude`라는 임의의 이름으로 데이터를 다루고 있으며 `address` 필드가 누락되어 있습니다.
  - 단순하게 `initialData: Record<string, PoiResult[]>`로 타입을 바꾸게 되면, TypeScript 타입 체커(`tsc`)가 속성명 불일치로 빌드 오류를 야기하므로 임시방편으로 `any`를 적용했던 것입니다.
- **해결 전략**:
  - **대안 A (현 상태 유지형)**: 모킹용 데이터 구조에 맞추어 `Record<string, Array<{ name: string; latitude: number; longitude: number }>>` 처럼 정밀하게 타입을 명시하여 `any`를 걷어냅니다.
  - **대안 B (정공법/권장)**: 테스트 파일의 모킹 데이터들(37라인, 68라인, 93라인, 104라인, 139라인)을 실제 `PoiResult` 명세인 `lat`, `lon`, `address`로 완벽히 정규화하고, `initialData: Record<string, PoiResult[]>` 타입을 부여하여 도메인 타입 일관성을 확보합니다.

### 결함 3: 미사용 `result` 변수 할당
- **위치**: `src/__tests__/hooks/usePoiSearch.test.ts:107`
- **코드**:
  ```typescript
  const { result } = renderHook(() => usePoiSearch('신규위치'));
  ```
- **원인**: FIFO 캐시 밀어내기 및 만료 테스트에서는 `renderHook`을 통해 훅만 실행하고 결과 검증은 `sessionStorage`를 직접 파싱하여 수행합니다. 그러나 불필요하게 `const { result } = `를 통째로 구조분해 할당을 받아 둠으로써 `@typescript-eslint/no-unused-vars` 에러가 발생했습니다.
- **해결 전략**: 미사용 구조분해 할당 부분인 `const { result } = `를 통째로 걷어내고 `renderHook(() => usePoiSearch('신규위치'));`로 변경합니다.

---

## 3. 상세 수정 가이드라인 (Before / After)

### [가이드 1] 7라인 `mockSearchPOIList` 함수 인자 타입 에러 해결

#### Before
```typescript
// tmap core 및 geocoding mock
const mockSearchPOIList = vi.fn();
vi.mock('../../lib/tmap/geocoding', () => ({
    searchPOIList: (...args: any[]) => mockSearchPOIList(...args),
}));
```

#### After (Strict Typing 적용)
```typescript
import type { PoiResult } from '../../lib/tmap/geocoding';

// tmap core 및 geocoding mock
const mockSearchPOIList = vi.fn();
vi.mock('../../lib/tmap/geocoding', () => ({
    searchPOIList: (keyword: string, count?: number): Promise<PoiResult[]> => 
        mockSearchPOIList(keyword, count),
}));
```
*(참고: `import type`은 컴파일 후 제거되므로 런타임 호이스팅에 아무런 부작용을 일으키지 않습니다.)*

---

### [가이드 2] 89라인 `initialData` 캐시 맵 타입 에러 해결

#### [선택지 1] 대안 B (권장 - 실제 도메인 타입 규격 통일 및 정밀 캐싱 검증)
- 테스트 코드 전반의 모크 데이터를 실제 `PoiResult` 규격(`lat`, `lon`, `address`)에 맞추고 `initialData`에 `Record<string, PoiResult[]>`를 부여하는 가장 모범적인 방법입니다.

##### Before (usePoiSearch.test.ts 내의 모크 형태 파편화)
```typescript
37:         const mockResults = [{ name: '서울시청', latitude: 37.5665, longitude: 126.9780 }];
...
68:         const mockResults = [{ name: '강남역', latitude: 37.4979, longitude: 127.0276 }];
...
89:         const initialData: Record<string, any> = {};
90:         for (let i = 1; i <= 50; i++) {
91:             const kw = `위치_${i}`;
92:             initialQueue.push(kw);
93:             initialData[kw] = [{ name: kw, latitude: 37, longitude: 126 }];
94:         }
...
104:         const mockResults = [{ name: '신규위치', latitude: 37.5, longitude: 126.5 }];
...
139:         const mockResults = [{ name: '에러테스트', latitude: 37, longitude: 126 }];
```

##### After (실제 `PoiResult` 규격으로 완벽 교정)
```typescript
import type { PoiResult } from '../../lib/tmap/geocoding';
...
37:         const mockResults: PoiResult[] = [{ name: '서울시청', lat: 37.5665, lon: 126.9780, address: '서울 중구 태평로1가 31' }];
...
68:         const mockResults: PoiResult[] = [{ name: '강남역', lat: 37.4979, lon: 127.0276, address: '서울 강남구 역삼동 858' }];
...
89:         const initialData: Record<string, PoiResult[]> = {};
90:         for (let i = 1; i <= 50; i++) {
91:             const kw = `위치_${i}`;
92:             initialQueue.push(kw);
93:             initialData[kw] = [{ name: kw, lat: 37, lon: 126, address: '' }];
94:         }
...
104:         const mockResults: PoiResult[] = [{ name: '신규위치', lat: 37.5, lon: 126.5, address: '' }];
...
139:         const mockResults: PoiResult[] = [{ name: '에러테스트', lat: 37, lon: 126, address: '' }];
```

#### [선택지 2] 대안 A (최소 코드 변경 - 모킹 구조의 인라인 타입화)
- 기존 테스트 모킹 데이터 형태(`latitude`, `longitude`)를 그대로 유지하면서 `any`를 안전하게 배제하는 방법입니다.

##### After
```typescript
        // 50개 키워드를 캐시에 적재
        const initialQueue: string[] = [];
        const initialData: Record<string, Array<{ name: string; latitude: number; longitude: number }>> = {};
        for (let i = 1; i <= 50; i++) {
            const kw = `위치_${i}`;
            initialQueue.push(kw);
            initialData[kw] = [{ name: kw, latitude: 37, longitude: 126 }];
        }
```

---

### [가이드 3] 107라인 미사용 구조분해 할당 `result` 제거

#### Before
```typescript
        // 새로운 51번째 키워드 검색 시도
        const mockResults = [{ name: '신규위치', latitude: 37.5, longitude: 126.5 }];
        mockSearchPOIList.mockResolvedValueOnce(mockResults);

        const { result } = renderHook(() => usePoiSearch('신규위치'));

        // 타이머 진행
```

#### After
```typescript
        // 새로운 51번째 키워드 검색 시도
        const mockResults = [{ name: '신규위치', latitude: 37.5, longitude: 126.5 }];
        mockSearchPOIList.mockResolvedValueOnce(mockResults);

        renderHook(() => usePoiSearch('신규위치'));

        // 타이머 진행
```

---

## 4. 최종 결론 및 권고
- 본 린트 오류의 원인은 테스트 모킹 시 타입 명시 누락 및 모킹 대상과의 데이터 구조 규격 불일치로 발생했습니다.
- 이를 치유하기 위해 **대안 B (실제 도메인 타입인 `PoiResult`에 모킹 데이터를 단일화하는 방식)**를 적용할 것을 강력히 권장합니다. 이는 프론트엔드와 백엔드 간의 데이터 동기화를 보장하고, 테스트 코드가 실제 프로덕션 환경의 데이터 구조적 정밀도를 올바르게 모사할 수 있게 하여 코드 무결성을 획기적으로 향상시킵니다.
- 만약 모킹 코드 수정 범위를 최소화해야 하는 제약이 있는 경우 **대안 A** 역시 린트 위반을 무결하게 해소할 수 있는 훌륭한 대안입니다.
