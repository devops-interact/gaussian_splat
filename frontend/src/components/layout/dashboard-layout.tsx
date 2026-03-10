import { ReactNode } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { Sidebar } from './sidebar';

interface DashboardLayoutProps {
  children: ReactNode;
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();

  const activeItem = location.pathname.startsWith('/dashboard') ? 'projects' : 'projects';

  const handleNavigate = (id: string) => {
    if (id === 'projects') navigate('/dashboard');
    else if (id === 'settings') navigate('/dashboard/settings');
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="min-h-screen w-full bg-black flex">
      <Sidebar
        activeItem={activeItem}
        onNavigate={handleNavigate}
        userEmail={user?.email ?? ''}
        onLogout={handleLogout}
      />
      <div className="flex-1 flex flex-col min-w-0">
        <header className="sticky top-0 z-30 w-full border-b border-white/[0.04] bg-[#060606]/80 backdrop-blur-md">
          <div className="max-w-[1600px] mx-auto px-6 h-14 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h1 className="text-lg font-mono font-bold text-[#35c889] tracking-tighter">
                3D Scanner
              </h1>
              <span className="text-[10px] font-mono text-gray-600 border border-[#35c889]/[0.12] rounded px-1.5 py-0.5 text-[#35c889]/50">
                v0.1
              </span>
            </div>
            <span className="text-xs font-mono text-gray-500">Gaussian Splatting</span>
          </div>
        </header>

        <main className="flex-1 w-full overflow-auto">
          <div className="max-w-[1600px] mx-auto px-6 py-6">{children}</div>
        </main>
      </div>
    </div>
  );
}
