import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { LoadingScreen } from '../components/LoadingScreen';

export function ProtectedRoute() {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'loading') {
    return <LoadingScreen />;
  }

  if (status === 'anonymous') {
    return <Navigate to="/entrar" replace state={{ from: location.pathname }} />;
  }

  return <Outlet />;
}
