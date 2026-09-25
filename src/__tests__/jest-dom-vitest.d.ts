/**
 * jest-dom 검사 함수(`toBeInTheDocument` 등)의 타입을 Vitest 5에 붙인다.
 *
 * Vitest 5에서 `Assertion`의 타입 매개변수가 `<T>`에서 `<R, T>`로 바뀌었고, 사용자 정의 검사
 * 함수를 붙이는 공식 확장 지점은 `Matchers<R, T>`가 됐다. jest-dom 7.0.1의 `vitest.d.ts`는 아직
 * 옛 모양의 `Assertion<T>`를 확장해 선언이 합쳐지지 않는다 — 실행은 되지만 타입 검사에서
 * `toBeInTheDocument`가 없다고 나온다(2026-09-25 의존성 PR #413).
 *
 * 매개변수 이름·제약·기본값은 Vitest의 `Matchers` 선언과 **똑같아야** 합쳐진다.
 * jest-dom이 Vitest 5 모양을 지원하면 이 파일은 지워도 된다.
 */
import type { TestingLibraryMatchers } from '@testing-library/jest-dom/matchers';

declare module 'vitest' {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- T는 쓰지 않지만 병합하려면 Vitest 선언과 이름이 같아야 한다
    interface Matchers<R extends void | Promise<void> = void | Promise<void>, T = unknown>
        extends TestingLibraryMatchers<unknown, R> {}
}
