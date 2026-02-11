import { ReactNode } from 'react';

interface DashboardLayoutProps {
    children: ReactNode;
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
    return (
        <div className="min-h-screen w-full bg-black">
            {/* Top Bar */}
            <header className="sticky top-0 z-30 w-full border-b border-white/[0.06] bg-black/80 backdrop-blur-md">
                <div className="max-w-[1600px] mx-auto px-6 h-14 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <h1 className="text-lg font-mono font-bold text-green-500 tracking-tighter">
                            Metroa Labs
                        </h1>
                        <span className="text-[10px] font-mono text-gray-600 border border-white/[0.06] rounded px-1.5 py-0.5">
                            v0.1
                        </span>
                    </div>
                    <div className="flex items-center gap-4">
                        <span className="text-xs font-mono text-gray-500">
                            Gaussian Splatting
                        </span>
                    </div>
                </div>
            </header>

            {/* Main Content */}
            <main className="w-full">
                <div className="max-w-[1600px] mx-auto px-6 py-6">
                    {children}
                </div>
            </main>
        </div>
    );
}
