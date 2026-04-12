'use client';

import { motion } from 'framer-motion';
import { FolderOpen, Settings, User, LogOut } from 'lucide-react';

interface SidebarProps {
  activeItem?: string;
  onNavigate?: (id: string) => void;
  userEmail?: string;
  onLogout?: () => void;
}

export function Sidebar({ activeItem = 'projects', onNavigate, userEmail = '', onLogout }: SidebarProps) {
  const navigationItems = [
    { id: 'projects', label: 'My Projects', icon: FolderOpen, href: '/dashboard' },
    { id: 'settings', label: 'Settings', icon: Settings, href: '/dashboard/settings' },
  ];

  return (
    <div className="w-64 bg-black flex flex-col h-full border-r border-white/[0.18] flex-shrink-0">
      <div className="p-6 flex flex-col h-full">
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.3 }}
        >
          <h2 className="text-2xl font-mono font-bold text-[#efe752] mb-8 tracking-tighter">
            METROA
          </h2>
        </motion.div>

        <motion.div
          className="flex items-center mb-8"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.1 }}
        >
          <div className="w-10 h-10 bg-white/10 rounded-full flex items-center justify-center mr-3 border border-white/[0.20]">
            <User className="w-5 h-5 text-gray-300" />
          </div>
          <span className="text-gray-200 font-mono text-sm truncate" title={userEmail}>
            {userEmail || 'User'}
          </span>
        </motion.div>

        <nav className="space-y-2 flex-1">
          {navigationItems.map((item, index) => {
            const Icon = item.icon;
            const isActive = activeItem === item.id;
            return (
              <motion.button
                key={item.id}
                onClick={() => onNavigate?.(item.id)}
                className={`flex w-full items-center px-4 py-3 rounded-lg font-mono text-sm transition-colors duration-200 ${
                  isActive
                    ? 'bg-[#efe752]/[0.08] text-[#efe752] border border-[#efe752]/[0.38]'
                    : 'text-gray-500 hover:text-gray-200 hover:bg-white/[0.04]'
                }`}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.3, delay: 0.1 + index * 0.05 }}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                <Icon className="w-4 h-4 mr-3" />
                {item.label}
              </motion.button>
            );
          })}
        </nav>

        <motion.div
          className="pt-4 border-t border-white/[0.16]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3, delay: 0.3 }}
        >
          <button
            onClick={onLogout}
            className="flex w-full items-center px-4 py-3 rounded-lg font-mono text-sm text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
          >
            <LogOut className="w-4 h-4 mr-3" />
            Log out
          </button>
          <p className="text-gray-600 text-xs font-mono mt-4">Gaussian Splat v0.1</p>
        </motion.div>
      </div>
    </div>
  );
}
