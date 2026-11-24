import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { LoadingScreen } from '../components/LoadingScreen';

export function PublicOnlyRoute() {
  const { status } = useAuth();

  if (status === 'loading') {
    return <LoadingScreen />;
  }

  if (status === 'authenticated') {
    return <Navigate to="/conta" replace />;
  }

  return <Outlet />;
}
