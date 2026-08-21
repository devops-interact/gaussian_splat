import { ReactNode } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { Sidebar } from './sidebar';
import { BRAND_NAME, BRAND_TAGLINE, BRAND_VERSION } from '@/lib/brand';

interface DashboardLayoutProps {
  children: ReactNode;
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();

  const activeItem = location.pathname.startsWith('/dashboard/settings') ? 'settings' : 'projects';

  const handleNavigate = (id: string) => {
    if (id === 'projects') navigate('/dashboard');
    else if (id === 'settings') navigate('/dashboard/settings');
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="h-screen w-full bg-neutral-950 flex overflow-hidden">
      <Sidebar
        activeItem={activeItem}
        onNavigate={handleNavigate}
        userEmail={user?.email ?? ''}
        onLogout={handleLogout}
      />
      <div className="flex-1 flex flex-col min-w-0">
        <header className="sticky top-0 z-30 w-full border-b border-white/[0.18] bg-neutral-950/80 backdrop-blur-md">
          <div className="max-w-[1600px] mx-auto px-6 h-14 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h1 className="text-lg font-bold text-white tracking-tighter">
                {BRAND_NAME}
              </h1>
              <span className="text-[10px] text-gray-600 border border-white/[0.32] rounded px-1.5 py-0.5 text-white/50">
                {BRAND_VERSION}
              </span>
            </div>
            <span className="text-xs text-gray-500">{BRAND_TAGLINE}</span>
          </div>
        </header>

        <main className="flex-1 w-full overflow-auto">
          <div className="max-w-[1600px] mx-auto px-6 py-6">{children}</div>
        </main>
      </div>
    </div>
  );
}
