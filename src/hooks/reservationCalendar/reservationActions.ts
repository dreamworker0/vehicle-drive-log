/**
 * reservationActions.ts — Proxy Re-export
 * 이 파일은 actions/ 폴더로 분해된 모듈들을 기존 인터페이스를 유지한 채 재수출합니다.
 * 기존 코드의 import 경로 변경 없이 리팩토링 효과를 얻을 수 있습니다.
 * 실제 로직은 actions/ 내부의 개별 파일을 수정하세요.
 */

// 타입 재수출
export type { ActionDeps, EditDeps, CancelDeps, SaveFavoriteDeps } from './actions/types';

// 함수 재수출
export { handleSubmit } from './actions/submitActions';
export { handleEdit } from './actions/editActions';
export { handleCancel } from './actions/cancelActions';
export { handleSaveFavorite } from './actions/favoriteActions';
