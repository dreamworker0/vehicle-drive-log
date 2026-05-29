# POI 검색 캐싱 테스트 코드 린트 결함 치유 분석 보고서 (analysis.md)

- **작성 일자**: 2026-05-29
- **작성자**: Explorer 3 에이전트 (Retry)
- **과제 범위**: 차량운행일지 PWA 서비스 POI 검색 캐싱 개선 (Milestone 1) 내 테스트 결함 해결
- **대상 파일**: `src/__tests__/hooks/usePoiSearch.test.ts`

---

## 1. 개요 및 린트 위반 현황

이전 구현 단계에서 작성된 테스트 파일인 `src/__tests__/hooks/usePoiSearch.test.ts`에서 총 3건의 ESLint 위반이 감지되어 빌드가 차단되고 무결성 실패(INTEGRITY VIOLATION) 판정을 받았습니다. 

에이전트 행동 헌법 **D4(any 타입 명시적 사용 금지)**와 **D5(미사용 변수/import 금지)** 및 TypeScript의 엄격한 타입 지향(strict typing) 원칙에 의거하여, 아래와 같이 린트 오류 3건에 대해 정확한 발생 원인 분석 및 완벽한 Before/After 치유 전략을 제안합니다.

### 린트 에러 요약 표

| 번호 | 파일 및 위치 | 위반 규칙 ID | 에러 메시지 내용 | 요약 원인 |
| :--- | :--- | :--- | :--- | :--- |
| **1** | `usePoiSearch.test.ts:7:30` | `@typescript-eslint/no-explicit-any` | Unexpected any. Specify a different type. | `searchPOIList` 모킹 인수 타입으로 `any[]` 사용 |
| **2** | `usePoiSearch.test.ts:89:43` | `@typescript-eslint/no-explicit-any` | Unexpected any. Specify a different type. | 캐시 맵 초기 데이터 객체의 값 타입으로 `any` 사용 |
| **3** | `usePoiSearch.test.ts:107:17` | `@typescript-eslint/no-unused-vars` | 'result' is assigned a value but never used. | `renderHook`의 반환값 `result`를 구조분해 후 미사용 |

---

## 2. 결함별 정밀 분석 및 수정 전략

### 2.1 결함 #1: `searchPOIList` 모킹 시 `any[]` 명시적 사용

#### [원인 분석]
- `usePoiSearch.test.ts` 파일의 7라인 부근에서 TMap geocoding API의 `searchPOIList`를 모킹하면서 가변 인자를 mock 함수에 단순 전달하기 위해 스프레드 연산자와 `any[]`를 매개변수 타입으로 정의했습니다.
  ```typescript
  vi.mock('../../lib/tmap/geocoding', () => ({
      searchPOIList: (...args: any[]) => mockSearchPOIList(...args),
  }));
  ```
- 이는 TypeScript strict 모드 하에서 허용되지 않는 명시적 `any` 타입 지정을 트리거하여 빌드를 실패하게 만들었습니다.
- **원본 라이브러리 분석 (`src/lib/tmap/geocoding.ts:39`)**:
  실제 `searchPOIList` 함수 서명은 다음과 같습니다.
  ```typescript
  export const searchPOIList = async (keyword: string, count = 5): Promise<PoiResult[]>
  ```

#### [수정 전략]
- 모킹할 때 본래 함수 서명인 `(keyword: string, count?: number)` 구조를 명시해주어 `any` 타입을 완벽하게 배제합니다.
- TypeScript의 추론 기능을 유기적으로 이용하고 함수 서명의 안전성을 확보할 수 있는 완벽한 모킹 인터페이스를 구축합니다.

#### [Before / After 코드 가이드라인]

##### Before (기존 코드)
```typescript
const mockSearchPOIList = vi.fn();
vi.mock('../../lib/tmap/geocoding', () => ({
    searchPOIList: (...args: any[]) => mockSearchPOIList(...args),
}));
```

##### After (수정 제안 코드)
```typescript
const mockSearchPOIList = vi.fn();
vi.mock('../../lib/tmap/geocoding', () => ({
    searchPOIList: (keyword: string, count?: number) => mockSearchPOIList(keyword, count),
}));
```

---

### 2.2 결함 #2: 캐시 데이터 맵 `initialData` 변수의 `any` 사용

#### [원인 분석]
- `usePoiSearch.test.ts` 파일의 89라인 부근 FIFO 링 버퍼 삭제 테스트 케이스 내에서, 캐시 내부에 강제로 50개의 아이템을 채우는 작업을 수행하기 위해 `initialData` 객체를 `Record<string, any>` 타입으로 선언했습니다.
- **원본 훅 구조 분석 (`src/hooks/usePoiSearch.ts:22`)**:
  원래 POI 검색의 캐시 구조는 다음과 같은 구조를 가지고 있습니다.
  ```typescript
  interface PoiCacheData {
      queue: string[];
      data: Record<string, PoiResult[]>;
  }
  ```
  그리고 테스트 코드 93라인에서는 다음과 같이 데이터가 바인딩됩니다.
  ```typescript
  initialData[kw] = [{ name: kw, latitude: 37, longitude: 126 }];
  ```

#### [수정 전략]
- **해결책 A (가장 단순하고 경제적인 방법)**:
  `any`를 완전히 대체하는 `unknown` 타입을 적용합니다. `initialData`의 타입을 `Record<string, unknown>`으로 지정합니다. 이 방법은 변수의 스키마가 임시 목 스키마인 상태에서 어떠한 추가 타입 선언도 필요로 하지 않고 `any` 사용만 완벽하게 금지하므로 감사관 권고사항을 충족시키는 가장 효과적인 방법입니다.
- **해결책 B (가장 견고한 방법 - 추천)**:
  테스트 스키마에 특화된 목 데이터 타입을 선언하여 할당하는 형태를 강력히 통제합니다.
  ```typescript
  interface MockPoiItem {
      name: string;
      latitude: number;
      longitude: number;
  }
  const initialData: Record<string, MockPoiItem[]> = {};
  ```

#### [Before / After 코드 가이드라인]

##### Before (기존 코드)
```typescript
    it('FIFO 링 버퍼: 50개가 초과되면 가장 오래된 키워드와 데이터가 캐시에서 삭제된다', async () => {
        // 50개 키워드를 캐시에 적재
        const initialQueue: string[] = [];
        const initialData: Record<string, any> = {};
        for (let i = 1; i <= 50; i++) {
            const kw = `위치_${i}`;
            initialQueue.push(kw);
            initialData[kw] = [{ name: kw, latitude: 37, longitude: 126 }];
        }
```

##### After (수정 제안 코드 - 해결책 B 적용)
```typescript
    it('FIFO 링 버퍼: 50개가 초과되면 가장 오래된 키워드와 데이터가 캐시에서 삭제된다', async () => {
        // 50개 키워드를 캐시에 적재
        const initialQueue: string[] = [];
        
        // Mocking용 타입 정의를 통해 any를 완전히 배제하여 Type-safe 확보
        interface MockPoiItem {
            name: string;
            latitude: number;
            longitude: number;
        }
        const initialData: Record<string, MockPoiItem[]> = {};
        
        for (let i = 1; i <= 50; i++) {
            const kw = `위치_${i}`;
            initialQueue.push(kw);
            initialData[kw] = [{ name: kw, latitude: 37, longitude: 126 }];
        }
```

*참고: 만약 해결책 A를 적용하는 경우에는 간단히 `const initialData: Record<string, unknown> = {};`로 선언하여 무결성을 만족시킬 수 있습니다.*

---

### 2.3 결함 #3: `result` 변수 선언 후 미사용 결함

#### [원인 분석]
- `usePoiSearch.test.ts` 파일의 107라인 부근 FIFO 링 버퍼 테스트 케이스 하단에서 새 검색어를 검색하는 과정을 가상 렌더링하기 위해 `renderHook`을 사용했습니다.
  ```typescript
  107:         const { result } = renderHook(() => usePoiSearch('신규위치'));
  ```
- 하지만 이 테스트 케이스에서는 `renderHook`이 반환하는 `result`의 상태 필드들을 전혀 감증(assertion)하거나 사용하지 않고 있습니다. 대신 타이머를 `vi.advanceTimersByTime(500)`만큼 흘려보내 `mockSearchPOIList` 함수가 호출되었는지를 보고, 이후 `sessionStorage` 내부 구조가 강제로 만료되었는지(FIFO)만을 추적 및 검증합니다.
- 이로 인하여 `result` 변수가 할당되었으나 사용되지 않는 미사용 변수 린트 에러(`@typescript-eslint/no-unused-vars`)가 발생하여 에이전트 행동 헌법 **D5**를 위반하게 되었습니다.

#### [수정 전략]
- 구조분해할당으로 받던 `{ result }` 구문을 완전히 지우고, 단지 훅을 렌더링하여 라이프사이클과 디바운스 이벤트를 동작시킬 수 있도록 `renderHook` 함수 단독으로만 호출하게 변경합니다.

#### [Before / After 코드 가이드라인]

##### Before (기존 코드)
```typescript
        // 새로운 51번째 키워드 검색 시도
        const mockResults = [{ name: '신규위치', latitude: 37.5, longitude: 126.5 }];
        mockSearchPOIList.mockResolvedValueOnce(mockResults);

        const { result } = renderHook(() => usePoiSearch('신규위치'));

        // 타이머 진행
        await act(async () => {
            vi.advanceTimersByTime(500);
        });
```

##### After (수정 제안 코드)
```typescript
        // 새로운 51번째 키워드 검색 시도
        const mockResults = [{ name: '신규위치', latitude: 37.5, longitude: 126.5 }];
        mockSearchPOIList.mockResolvedValueOnce(mockResults);

        // 미사용 변수 'result'를 구조분해 및 선언하지 않고 훅 동작 자체만 트리거
        renderHook(() => usePoiSearch('신규위치'));

        // 타이머 진행
        await act(async () => {
            vi.advanceTimersByTime(500);
        });
```

---

## 3. 에이전트 행동 헌법 준수 및 타입 안전성 검증

1. **`any` 명시적 타입 배제 완료 (D4 위반 해소)**:
   - `searchPOIList` 모킹 부분에서 `keyword: string, count?: number`로 엄격히 선언하여 TypeScript strict 모드를 관통하는 우아한 시그니처를 제공합니다.
   - `initialData` 객체에 `unknown` 또는 구체적 모킹 구조체인 `MockPoiItem[]`를 바인딩하여 `any`를 실체적 타입 체계로 승격시킵니다.
2. **미사용 변수 완벽 해소 (D5 위반 해소)**:
   - 불필요한 `{ result }` 할당을 과감히 제거하여 `no-unused-vars` 에러가 발생할 소지를 근본적으로 소멸시켰습니다.
3. **영향도 검증**:
   - 이 수정 제안은 테스트 로직의 구조나 본래 테스트하고자 하는 검증 기능(Debounce, FIFO, StorageException 가드 등)에 전혀 부정적인 영향을 미치지 않고, 100% 안전하게 린트 위반 결함만을 치유합니다.
