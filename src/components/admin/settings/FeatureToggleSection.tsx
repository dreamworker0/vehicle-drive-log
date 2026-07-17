/**
 * FeatureToggleSection — Settings의 "기능 사용" 토글 섹션(표시 전용)
 * 기능을 도메인 그룹(차량 관리 / 운전자 기록 / 동승자)으로 묶고,
 * 각 입력·선택 방식 토글을 관련 기능 바로 아래에 종속 배치한다.
 * 각 토글 변경 시 부모의 onChange(=handleSave overrides)로 즉시 저장한다.
 * 방식 토글은 켜진 것만 직원 화면에 노출하며 최소 1개는 유지(마지막 하나 잠금)한다.
 */
import Toggle from '../../common/Toggle';

export interface FeatureToggleValues {
    requireReservationApproval: boolean;
    hipassEnabled: boolean;
    maintenanceEnabled: boolean;
    maintenanceEmployeeAccess: boolean;
    allowedUsersEnabled: boolean;
    googleCalendarEnabled: boolean;
    driverSelectionEnabled: boolean;
    coDriverEnabled: boolean;
    passengerEnabled: boolean;
    // 입력 방식 개별 활성화
    passengerAllowList: boolean;
    passengerAllowSearch: boolean;
    passengerAllowCount: boolean;
    driverAllowList: boolean;
    driverAllowSearch: boolean;
}

interface FeatureToggleSectionProps {
    values: FeatureToggleValues;
    onChange: (patch: Partial<FeatureToggleValues>) => void;
}

type FeatureKey = 'requireReservationApproval' | 'hipassEnabled' | 'maintenanceEnabled' | 'allowedUsersEnabled' | 'googleCalendarEnabled' | 'driverSelectionEnabled' | 'coDriverEnabled' | 'passengerEnabled';

const FEATURE_META: Record<FeatureKey, { label: string; desc: string }> = {
    requireReservationApproval: { label: '예약 관리자 승인', desc: '켜면 직원 차량 예약이 즉시 확정되지 않고 관리자 승인을 거칩니다.' },
    hipassEnabled: { label: '하이패스', desc: '끄면 운행일지 하이패스 입력과 차량관리 하이패스 탭, 관리자 하이패스 관리 메뉴가 숨겨집니다.' },
    maintenanceEnabled: { label: '수리·정비', desc: '끄면 차량관리 수리·정비 탭과 관리자 정비 기록 메뉴가 숨겨집니다.' },
    allowedUsersEnabled: { label: '사용 가능 직원 지정', desc: '끄면 차량 등록 시 특정 직원만 사용하도록 지정하는 항목이 숨겨집니다.' },
    googleCalendarEnabled: { label: 'Google 캘린더 연동', desc: '끄면 차량 등록 시 Google 캘린더 연동 항목이 숨겨집니다.' },
    driverSelectionEnabled: { label: '운전자 지정', desc: '끄면 운행일지에서 운전자를 바꿀 수 없고 항상 작성자로 기록됩니다.' },
    coDriverEnabled: { label: '공동 운전자', desc: '끄면 운행일지의 공동 운전자 입력이 숨겨집니다.' },
    passengerEnabled: { label: '동승자', desc: '끄면 운행일지의 동승자 입력이 숨겨집니다.' },
};

/** 기능 on/off 한 줄(굵은 라벨) */
function FeatureRow({
    label, desc, checked, onChange,
}: { label: string; desc: string; checked: boolean; onChange: (next: boolean) => void }) {
    return (
        <div className="flex items-start justify-between gap-3 py-3">
            <div className="min-w-0">
                <p className="text-sm font-medium text-surface-800 dark:text-surface-200">{label}</p>
                <p className="text-xs text-surface-400 dark:text-surface-500 mt-0.5">{desc}</p>
            </div>
            <label className="flex items-center gap-2 cursor-pointer select-none flex-shrink-0">
                <span className={`text-xs font-medium ${!checked ? 'text-surface-400 dark:text-surface-500' : 'text-primary-600 dark:text-primary-400'}`}>
                    {checked ? '사용' : '사용 안함'}
                </span>
                <Toggle label={label} checked={checked} onChange={onChange} />
            </label>
        </div>
    );
}

/** 하위 방식 토글 한 줄(일반 라벨) */
function MethodRow({
    label, desc, checked, onChange, disabled,
}: { label: string; desc?: string; checked: boolean; onChange: (next: boolean) => void; disabled?: boolean }) {
    return (
        <div className="flex items-start justify-between gap-3 py-2">
            <div className="min-w-0">
                <p className="text-sm text-surface-700 dark:text-surface-300">{label}</p>
                {desc && <p className="text-xs text-surface-400 dark:text-surface-500 mt-0.5">{desc}</p>}
            </div>
            <label className="flex items-center gap-2 cursor-pointer select-none flex-shrink-0">
                <span className={`text-xs font-medium ${!checked ? 'text-surface-400 dark:text-surface-500' : 'text-primary-600 dark:text-primary-400'}`}>
                    {checked ? '사용' : '사용 안함'}
                </span>
                <Toggle label={label} checked={checked} onChange={onChange} disabled={disabled} />
            </label>
        </div>
    );
}

/** 도메인 그룹 소제목 */
function GroupTitle({ children }: { children: React.ReactNode }) {
    return (
        <p className="text-xs font-semibold uppercase tracking-wide text-surface-500 dark:text-surface-400 mb-1">
            {children}
        </p>
    );
}

/** 상위 기능에 종속되는 방식 블록(들여쓰기 + 좌측 연결선) */
function MethodGroup({ caption, children }: { caption: string; children: React.ReactNode }) {
    return (
        <div className="mt-1 mb-1 ml-1 pl-3 border-l-2 border-surface-200 dark:border-surface-700">
            <p className="text-xs font-medium text-surface-500 dark:text-surface-400 pt-1">{caption}</p>
            {children}
        </div>
    );
}

export default function FeatureToggleSection({ values, onChange }: FeatureToggleSectionProps) {
    const passengerOnCount = [values.passengerAllowList, values.passengerAllowSearch, values.passengerAllowCount].filter(Boolean).length;
    const driverOnCount = [values.driverAllowList, values.driverAllowSearch].filter(Boolean).length;

    // 마지막 하나를 끄려는 시도는 무시(항상 1개 이상 유지)
    const guard = (key: keyof FeatureToggleValues, next: boolean, onCount: number) => {
        if (!next && onCount <= 1) return;
        onChange({ [key]: next });
    };

    const feature = (key: FeatureKey) => (
        <FeatureRow
            label={FEATURE_META[key].label}
            desc={FEATURE_META[key].desc}
            checked={values[key]}
            onChange={(next) => onChange({ [key]: next })}
        />
    );

    return (
        <div className="glass-card p-6 mb-6">
            <h2 className="text-lg font-semibold text-surface-900 dark:text-surface-100 mb-1">기능 사용 설정</h2>
            <p className="text-xs text-surface-400 mb-5">
                💡 기관에서 쓰지 않는 기능을 끄면 관련 입력·탭·메뉴가 직원 화면에서 사라져 더 깔끔해집니다. (기본값은 모두 켜짐)
            </p>

            {/* 차량 예약 */}
            <div className="mb-5">
                <GroupTitle>🗓️ 차량 예약</GroupTitle>
                <div className="divide-y divide-surface-100 dark:divide-surface-700">
                    {feature('requireReservationApproval')}
                </div>
            </div>

            {/* 차량 관리 */}
            <div className="mb-5 pt-5 border-t border-surface-100 dark:border-surface-700">
                <GroupTitle>🚐 차량 관리</GroupTitle>
                <div className="divide-y divide-surface-100 dark:divide-surface-700">
                    {feature('hipassEnabled')}
                    {feature('maintenanceEnabled')}
                </div>
                {values.maintenanceEnabled && (
                    <MethodGroup caption="접근 범위">
                        <MethodRow
                            label="일반 직원도 사용"
                            desc="끄면 관리자만 정비를 기록하고, 일반 직원 화면의 수리·정비 탭이 숨겨집니다."
                            checked={values.maintenanceEmployeeAccess}
                            onChange={(next) => onChange({ maintenanceEmployeeAccess: next })}
                        />
                    </MethodGroup>
                )}
            </div>

            {/* 차량 등록 옵션 */}
            <div className="mb-5 pt-5 border-t border-surface-100 dark:border-surface-700">
                <GroupTitle>🚗 차량 등록 옵션</GroupTitle>
                <div className="divide-y divide-surface-100 dark:divide-surface-700">
                    {feature('allowedUsersEnabled')}
                    {feature('googleCalendarEnabled')}
                </div>
            </div>

            {/* 운전자 기록 */}
            <div className="mb-5 pt-5 border-t border-surface-100 dark:border-surface-700">
                <GroupTitle>🚗 운전자 기록</GroupTitle>
                <div className="divide-y divide-surface-100 dark:divide-surface-700">
                    {feature('driverSelectionEnabled')}
                    {feature('coDriverEnabled')}
                </div>
                {(values.driverSelectionEnabled || values.coDriverEnabled) && (
                    <MethodGroup caption="선택 방식 · 대표·공동 운전자에 적용. 둘 다 켜면 후보 8명 이하는 목록, 초과는 검색으로 자동 전환 (최소 1개)">
                        <MethodRow
                            label="직접 선택(목록)" desc="후보를 목록으로 보여주고 클릭해 선택"
                            checked={values.driverAllowList}
                            onChange={(next) => guard('driverAllowList', next, driverOnCount)}
                            disabled={values.driverAllowList && driverOnCount <= 1}
                        />
                        <MethodRow
                            label="검색으로 선택" desc="이름을 검색해 선택(인원이 많은 기관에 적합)"
                            checked={values.driverAllowSearch}
                            onChange={(next) => guard('driverAllowSearch', next, driverOnCount)}
                            disabled={values.driverAllowSearch && driverOnCount <= 1}
                        />
                    </MethodGroup>
                )}
            </div>

            {/* 동승자 */}
            <div className="pt-5 border-t border-surface-100 dark:border-surface-700">
                <GroupTitle>🧑‍🤝‍🧑 동승자</GroupTitle>
                <div className="divide-y divide-surface-100 dark:divide-surface-700">
                    {feature('passengerEnabled')}
                </div>
                {values.passengerEnabled && (
                    <MethodGroup caption="입력 방식 · 켠 방식만 동승자 입력에 표시 (최소 1개)">
                        <MethodRow
                            label="직원 직접 선택" desc="전체 직원 목록에서 클릭해 선택"
                            checked={values.passengerAllowList}
                            onChange={(next) => guard('passengerAllowList', next, passengerOnCount)}
                            disabled={values.passengerAllowList && passengerOnCount <= 1}
                        />
                        <MethodRow
                            label="검색으로 선택" desc="이름을 검색해 선택(인원이 많은 기관에 적합)"
                            checked={values.passengerAllowSearch}
                            onChange={(next) => guard('passengerAllowSearch', next, passengerOnCount)}
                            disabled={values.passengerAllowSearch && passengerOnCount <= 1}
                        />
                        <MethodRow
                            label="인원 숫자" desc="이름 없이 동승 인원 수만 입력"
                            checked={values.passengerAllowCount}
                            onChange={(next) => guard('passengerAllowCount', next, passengerOnCount)}
                            disabled={values.passengerAllowCount && passengerOnCount <= 1}
                        />
                    </MethodGroup>
                )}
            </div>
        </div>
    );
}
