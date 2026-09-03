/**
 * auditLogLabels — 접속기록의 코드값을 사람이 읽는 말로 옮기는 표
 *
 * 화면(AuditLogViewer)과 엑셀 내보내기가 **같은 표를 쓴다.** 각자 갖고 있으면 한쪽만
 * 갱신돼 "화면에는 반출인데 파일에는 수정"처럼 어긋나고, 그 어긋남은 점검 결과를
 * 잘못 읽게 만든다(서버가 쓰는 값이 늘 때 갱신할 지점을 하나로 묶는 이유이기도 하다).
 */
import type { AuditAction, AuditLog, AuditTargetType } from '../types/auditLog';

/** 수행업무 — 고시 제2조의 '수행업무'를 관리자가 읽는 말로 */
export const ACTION_LABEL: Record<AuditAction, string> = {
    login: '접속',
    create: '생성',
    update: '수정',
    delete: '삭제',
    export: '반출',
    read: '열람',
};

export const TARGET_LABEL: Record<AuditTargetType, string> = {
    driveLog: '운행일지',
    user: '직원 정보',
    session: '로그인',
    export: '내보내기',
    orgDocument: '기관 증빙서류',
};

/** 반출 대상 — 서버(recordExport)의 DATASETS 화이트리스트와 1:1 */
export const DATASET_LABEL: Record<string, string> = {
    driveLogs: '운행일지',
    dailyLogs: '일별 운행일지',
    fuelLogs: '주유 기록',
    hipassCharges: '하이패스 충전 기록',
    maintenance: '정비 기록',
    auditLogs: '접속기록',
};

export const FORMAT_LABEL: Record<string, string> = { excel: '엑셀', pdf: 'PDF' };

/** 변경 필드 — 서버(AUDITED_FIELDS) 화이트리스트와 1:1. 없는 이름은 원문을 그대로 쓴다. */
export const FIELD_LABEL: Record<string, string> = {
    organizationId: '소속 기관',
    organizationStatus: '기관 상태',
    driverUid: '운전자',
    driverName: '운전자 이름',
    createdByUid: '작성자',
    coDriverUids: '공동운전자',
    coDriverNames: '공동운전자 이름',
    passengerNames: '탑승자',
    date: '운행일',
    startLocation: '출발지',
    siteVaries: '출발지 변경 허용',
    currentSiteId: '현재 위치',
    destination: '목적지',
    purpose: '용무',
    notes: '비고',
    name: '이름',
    email: '이메일',
    phone: '연락처',
    photoURL: '프로필 사진',
    role: '권한',
    status: '계정 상태',
    consent: '약관 동의',
};

/** 행위자를 어떻게 알아냈는지 — 기록의 신뢰 수준을 숨기지 않고 그대로 보여준다 */
export const ACTOR_SOURCE_NOTE: Record<AuditLog['actorSource'], string> = {
    stamp: '',              // 위조 불가 — 부연할 것이 없다
    auth: '',               // 인증 토큰에서 확인 — 위조 불가
    document: '문서 기록으로 추정',
    unknown: '행위자 미확인',
};

/** `운행일지 수정`처럼 대상 + 수행업무를 한 덩어리로 */
export function describeEvent(log: Pick<AuditLog, 'action' | 'targetType'>): string {
    return `${TARGET_LABEL[log.targetType]} ${ACTION_LABEL[log.action]}`;
}

/** 바뀐 항목 이름 목록 — 값은 애초에 기록하지 않으므로 이름만 나온다 */
export function describeChangedFields(fields?: string[]): string {
    if (!fields?.length) return '';
    return fields.map((f) => FIELD_LABEL[f] ?? f).join(', ');
}

/** `운행일지 · 엑셀 파일`처럼 반출 대상과 형식을 한 줄로 */
export function describeExportTarget(log: Pick<AuditLog, 'exportDataset' | 'exportFormat'>): string {
    const dataset = log.exportDataset ? DATASET_LABEL[log.exportDataset] ?? log.exportDataset : '';
    const format = log.exportFormat ? FORMAT_LABEL[log.exportFormat] ?? log.exportFormat : '';
    return [dataset, format && `${format} 파일`].filter(Boolean).join(' · ');
}
