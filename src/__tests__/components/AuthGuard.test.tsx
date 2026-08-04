import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AuthGuard } from '../../components/auth/AuthGuard';

// App(무거운 의존성) 대신 가드가 쓰는 상수/로딩 화면만 가볍게 모킹
vi.mock('../../App', () => ({
  SA_TEST_ROLE_KEY: 'sa-test-role',
  LoadingScreen: () => <div>LOADING</div>,
}));

// BlockedScreen이 import하는 부수 모듈
vi.mock('../../lib/firestore', () => ({ clearUserOrganization: vi.fn() }));
vi.mock('../../lib/auth', () => ({ logout: vi.fn() }));

// useAuth 모킹 (테스트마다 값 교체)
type AuthState = {
  user: { uid: string } | null;
  userData: Record<string, unknown> | null;
  userDocState: 'pending' | 'present' | 'absent';
  isSuperAdmin: boolean;
  orgDeleted: boolean;
};
let mockAuth: AuthState;
vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => mockAuth,
}));

function renderAt(path: string, element: React.ReactNode) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={path} element={element} />
        <Route path="/invite" element={<div>INVITE</div>} />
        <Route path="/login" element={<div>LOGIN</div>} />
        <Route path="/employee" element={<div>EMP</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('AuthGuard — 사용자 문서 로딩 확정 전 라우팅 보류', () => {
  beforeEach(() => {
    mockAuth = {
      user: { uid: 'u1' },
      userData: null,
      userDocState: 'pending',
      isSuperAdmin: false,
      orgDeleted: false,
    };
  });

  it("pending 상태에서는 보호 라우트가 /invite로 가지 않고 로딩을 유지한다", () => {
    renderAt('/employee', (
      <AuthGuard requireAuth requireOrgSetup allowedRoles={['admin', 'employee']}>
        <div>EMP_CONTENT</div>
      </AuthGuard>
    ));
    expect(screen.getByText('LOADING')).toBeInTheDocument();
    expect(screen.queryByText('INVITE')).not.toBeInTheDocument();
  });

  it("pending 상태에서는 게스트 라우트(/)도 /invite로 가지 않고 로딩을 유지한다 (재방문 진입점 회귀)", () => {
    renderAt('/', (
      <AuthGuard requireGuest>
        <div>LANDING</div>
      </AuthGuard>
    ));
    expect(screen.getByText('LOADING')).toBeInTheDocument();
    expect(screen.queryByText('INVITE')).not.toBeInTheDocument();
  });

  it("문서가 확정적으로 없으면(absent) 비로소 /invite로 이동한다 (신규가입)", () => {
    mockAuth.userDocState = 'absent';
    renderAt('/employee', (
      <AuthGuard requireAuth requireOrgSetup allowedRoles={['admin', 'employee']}>
        <div>EMP_CONTENT</div>
      </AuthGuard>
    ));
    expect(screen.getByText('INVITE')).toBeInTheDocument();
  });

  it("문서가 로드되면(present) 정상적으로 보호 라우트 콘텐츠를 렌더한다", () => {
    mockAuth.userDocState = 'present';
    mockAuth.userData = { role: 'employee', organizationId: 'org1' };
    renderAt('/employee', (
      <AuthGuard requireAuth requireOrgSetup allowedRoles={['admin', 'employee']}>
        <div>EMP_CONTENT</div>
      </AuthGuard>
    ));
    expect(screen.getByText('EMP_CONTENT')).toBeInTheDocument();
  });

  it("비로그인 사용자는 pending 가드의 영향을 받지 않고 /login으로 이동한다", () => {
    mockAuth.user = null;
    renderAt('/employee', (
      <AuthGuard requireAuth requireOrgSetup allowedRoles={['admin', 'employee']}>
        <div>EMP_CONTENT</div>
      </AuthGuard>
    ));
    expect(screen.getByText('LOGIN')).toBeInTheDocument();
  });
});

/**
 * 슈퍼관리자 테스트 역할은 **탭마다 독립**이어야 한다(sessionStorage).
 *
 * localStorage로 두면 탭 간 공유라, 한 탭에서 역할을 바꾼 뒤 다른 탭이 리로드되는 순간
 * 그 탭도 바뀐 역할로 끌려갔다 — 직원 화면과 관리자 화면을 나란히 띄워 보는 것이 이 기능의
 * 용도인데 그게 불가능했다. 되돌림을 잡으려고 "localStorage에만 값이 있으면 무시한다"까지
 * 단언한다(그게 없으면 두 스토리지를 모두 읽는 구현도 통과한다).
 */
describe('AuthGuard — 슈퍼관리자 테스트 역할은 탭 단위(sessionStorage)', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    mockAuth = {
      user: { uid: 'sa1' },
      userData: { role: 'superAdmin', organizationId: 'org1' },
      userDocState: 'present',
      isSuperAdmin: true,
      orgDeleted: false,
    };
  });

  it('sessionStorage의 테스트 역할을 반영한다 (employee로 지정하면 직원 라우트를 통과)', () => {
    sessionStorage.setItem('sa-test-role', 'employee');
    renderAt('/employee', (
      <AuthGuard requireAuth requireOrgSetup allowedRoles={['employee']}>
        <div>EMP_CONTENT</div>
      </AuthGuard>
    ));
    expect(screen.getByText('EMP_CONTENT')).toBeInTheDocument();
  });

  it('localStorage에만 값이 있으면 무시한다 (탭 간 공유 회귀 차단)', () => {
    localStorage.setItem('sa-test-role', 'employee');
    // 지정이 없는 것과 같아야 하므로 effectiveRole은 superAdmin — 직원 전용 라우트는 막힌다
    renderAt('/employee', (
      <AuthGuard requireAuth requireOrgSetup allowedRoles={['employee']}>
        <div>EMP_CONTENT</div>
      </AuthGuard>
    ));
    expect(screen.queryByText('EMP_CONTENT')).not.toBeInTheDocument();
  });

  it('지정이 없으면 슈퍼관리자 그대로다 (직원 전용 라우트 접근 불가)', () => {
    renderAt('/employee', (
      <AuthGuard requireAuth requireOrgSetup allowedRoles={['employee']}>
        <div>EMP_CONTENT</div>
      </AuthGuard>
    ));
    expect(screen.queryByText('EMP_CONTENT')).not.toBeInTheDocument();
  });
});
