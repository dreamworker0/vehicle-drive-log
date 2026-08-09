/**
 * `/apply` 전용 라우트 래퍼.
 *
 * 기관 신청 폼(useOrgApplication)만 비인증 경로에서 `useAuth`를 쓴다. 그래서 AuthProvider를
 * 경량 엔트리 최상단에 두면 **랜딩만 보러 온 사람도 Firestore SDK를 통째로 내려받는다**
 * (useAuth → lib/firebase → firebase/firestore, 전송 164KB). 이 경로에서만 필요한 것을
 * 이 경로에서만 불러오도록 여기서 감싼다 — lightEntry가 이 모듈을 lazy로 부르므로
 * `/apply`에 들어가야 비로소 그 청크를 받는다.
 */
import { AuthProvider } from '../../hooks/useAuth';
import OrgApplicationPage from './OrgApplicationPage';

export default function OrgApplicationRoute() {
    return (
        <AuthProvider>
            <OrgApplicationPage />
        </AuthProvider>
    );
}
