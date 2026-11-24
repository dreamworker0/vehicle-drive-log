/**
 * 테스트 전용 `firebase-functions/logger` 대체 — 받은 인자를 그대로 `console`로 넘긴다.
 *
 * 진짜 logger는 모듈을 불러올 때 붙잡아 둔 원본 console(UNPATCHED_CONSOLE)로 쓴다. 그러면
 * `jest.spyOn(console, ...)`이 아무것도 보지 못해, console 출력을 검사하던 테스트(로그에 이메일이
 * 남지 않는지 등)가 **검사 대상 없이 통과**하게 된다. 운영 코드를 console에서 logger로 옮기면서
 * (2026-11-24) 그 테스트들이 같은 의미를 유지하도록 package.json jest.moduleNameMapper가 이 파일로 잇는다.
 *
 * 인자를 가공하지 않으므로 기존 단언(`toHaveBeenCalledWith('메시지', 값)`)이 그대로 맞는다.
 */
type Args = unknown[];

export const log = (...args: Args): void => console.log(...args);
export const info = (...args: Args): void => console.log(...args);
export const debug = (...args: Args): void => console.debug(...args);
export const warn = (...args: Args): void => console.warn(...args);
export const error = (...args: Args): void => console.error(...args);
export const write = (entry: unknown): void => console.log(entry);
