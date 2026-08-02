/**
 * Firestore — 접속기록 조회 (기관 관리자 점검용, 읽기만)
 *
 * 근거: 고시 「개인정보의 안전성 확보조치 기준」 제16조 ②는 접속기록을 **월 1회 이상
 * 점검**하도록 한다. 점검 주체는 개인정보처리자, 즉 각 기관이므로(이용약관 제9조)
 * 기관 관리자가 자기 기관 기록을 조회한다. Rules(`auditLogs`)도 같은 경계로 열려 있다.
 *
 * 쓰기 함수는 두지 않는다 — 기록은 서버(트리거·콜러블)만 하고 Rules가 클라이언트 쓰기를
 * 전면 차단한다. 여기에 쓰기 함수를 만들면 호출 즉시 permission-denied가 된다.
 *
 * `organizationId: '__system__'` 기록(기관 미소속 계정, 주로 superAdmin)은 실재하는
 * 기관 ID가 아니라 이 필터에 걸리지 않는다 — 의도된 동작이다.
 */
import {
    collection, query, where, orderBy, limit, getDocs, Timestamp,
    type QueryConstraint,
    type DocumentData,
} from 'firebase/firestore';
import { db } from '../firebase';
import { createZodConverter, auditLogSchema } from '../../schemas';
import type { AuditAction, AuditLog } from '../../types/auditLog';
import { captureError } from '../sentry';

const auditLogConverter = createZodConverter(auditLogSchema);

/** 한 번에 불러오는 건수 — 모바일 목록에서 한 화면 스크롤 분량 */
export const AUDIT_LOG_PAGE_SIZE = 50;

/**
 * 점검 화면의 유형 필터.
 *
 * 수행업무(action)를 화면 어휘로 묶는다. 관리자에게 필요한 구분은 "누가 들어왔나 /
 * 무엇이 바뀌었나 / 무엇이 나갔나"이고, create·update·delete를 따로 고르는 것은
 * 점검에 도움이 되지 않는다.
 */
export type AuditLogKind = 'all' | 'access' | 'change' | 'export';

/** 유형 → 수행업무 매핑. `all`은 필터를 걸지 않는다(단일 인덱스로 처리된다). */
const KIND_ACTIONS: Record<Exclude<AuditLogKind, 'all'>, AuditAction[]> = {
    access: ['login'],
    change: ['create', 'update', 'delete'],
    // 반출과 증빙서류 열람은 둘 다 "기관 밖으로 나간 사실"이라 함께 본다
    export: ['export', 'read'],
};

export interface AuditLogQueryOptions {
    /** 이 시각 이후의 기록만 (기간 필터) */
    since?: Date;
    kind?: AuditLogKind;
    /** 커서 — 이전 페이지의 `lastDoc` */
    startAfter?: unknown;
    pageSize?: number;
}

export interface AuditLogPage {
    logs: AuditLog[];
    /** 다음 페이지 커서. 더 없으면 null */
    lastDoc: unknown | null;
    hasMore: boolean;
}

/**
 * 기관의 접속기록을 최신순으로 조회한다.
 *
 * 인덱스: `all`은 `(organizationId, at desc)`, 유형 필터는 `(organizationId, action, at desc)`를
 * 쓴다(둘 다 firestore.indexes.json에 있다). `action`을 `in`으로 묶어도 같은 인덱스로 처리되므로
 * 유형이 늘어도 인덱스를 더 만들지 않는다.
 */
export const getAuditLogs = async (
    orgId: string,
    options: AuditLogQueryOptions = {},
): Promise<AuditLogPage> => {
    const pageSize = options.pageSize ?? AUDIT_LOG_PAGE_SIZE;
    try {
        const constraints: QueryConstraint[] = [
            where('organizationId', '==', orgId),
        ];

        const kind = options.kind ?? 'all';
        if (kind !== 'all') {
            constraints.push(where('action', 'in', KIND_ACTIONS[kind]));
        }
        if (options.since) {
            constraints.push(where('at', '>=', Timestamp.fromDate(options.since)));
        }

        constraints.push(orderBy('at', 'desc'), limit(pageSize));

        if (options.startAfter) {
            // 커서를 쓰는 화면에서만 필요한 함수라 초기 번들에 넣지 않는다
            const { startAfter: startAfterFn } = await import('firebase/firestore');
            constraints.push(startAfterFn(options.startAfter as DocumentData));
        }

        const q = query(
            collection(db, 'auditLogs').withConverter(auditLogConverter),
            ...constraints,
        );
        const snap = await getDocs(q);

        return {
            logs: snap.docs.map((d) => d.data()) as AuditLog[],
            lastDoc: snap.docs[snap.docs.length - 1] || null,
            hasMore: snap.docs.length === pageSize,
        };
    } catch (error) {
        captureError(error, { context: 'getAuditLogs', orgId, options });
        throw error;
    }
};
