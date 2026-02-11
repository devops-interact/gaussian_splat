'use client'

import { motion } from 'framer-motion'
import {
    FolderOpen,
    Clock,
    Settings,
    HelpCircle,
    User
} from 'lucide-react'

interface SidebarProps {
    activeItem?: string,
    onNavigate?: (id: string) => void
}

export function Sidebar({ activeItem = 'projects', onNavigate }: SidebarProps) {
    const navigationItems = [
        {
            id: 'projects',
            label: 'My Projects',
            icon: FolderOpen,
            href: '/dashboard'
        },
        {
            id: 'recent',
            label: 'Recent',
            icon: Clock,
            href: '/dashboard/recent'
        },
        {
            id: 'settings',
            label: 'Settings',
            icon: Settings,
            href: '/dashboard/settings'
        },
        {
            id: 'help',
            label: 'Help',
            icon: HelpCircle,
            href: '/help'
        }
    ]

    return (
        <div className="w-64 bg-[#060606] flex flex-col h-full border-r border-white/[0.04]">
            <div className="p-6">
                {/* Logo */}
                <motion.div
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.5 }}
                >
                    <h2 className="text-2xl font-mono font-bold text-[#35c889] mb-8 tracking-tighter">
                        Metroa Labs
                    </h2>
                </motion.div>

                {/* User Profile */}
                <motion.div
                    className="flex items-center mb-8"
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, delay: 0.1 }}
                >
                    <div className="w-10 h-10 bg-white/10 rounded-full flex items-center justify-center mr-3 border border-white/[0.06]">
                        <User className="w-5 h-5 text-gray-300" />
                    </div>
                    <span className="text-gray-200 font-mono text-sm">Carlos Martinez</span>
                </motion.div>

                {/* Navigation */}
                <nav className="space-y-2">
                    {navigationItems.map((item, index) => {
                        const Icon = item.icon
                        const isActive = activeItem === item.id

                        return (
                            <motion.button
                                key={item.id}
                                onClick={() => onNavigate && onNavigate(item.id)}
                                className={`flex w-full items-center px-4 py-3 rounded-lg font-mono text-sm transition-colors duration-200 ${isActive
                                        ? 'bg-[#35c889]/[0.08] text-[#35c889] border border-[#35c889]/[0.15]'
                                        : 'text-gray-500 hover:text-gray-200 hover:bg-white/[0.04]'
                                    }`}
                                initial={{ opacity: 0, x: -20 }}
                                animate={{ opacity: 1, x: 0 }}
                                transition={{ duration: 0.5, delay: 0.1 + index * 0.1 }}
                                whileHover={{ scale: 1.02 }}
                                whileTap={{ scale: 0.98 }}
                            >
                                <Icon className="w-4 h-4 mr-3" />
                                {item.label}
                            </motion.button>
                        )
                    })}
                </nav>
            </div>

            {/* Footer */}
            <motion.div
                className="mt-auto p-6 border-t border-white/[0.04]"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.5, delay: 0.6 }}
            >
                <p className="text-gray-600 text-xs font-mono">Gaussian Splat v0.1</p>
            </motion.div>
        </div>
    )
}
