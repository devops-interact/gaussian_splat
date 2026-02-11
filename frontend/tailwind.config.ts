import type { Config } from 'tailwindcss'

const config: Config = {
    content: [
        './index.html',
        './src/**/*.{js,ts,jsx,tsx}',
    ],
    darkMode: 'class',
    theme: {
        extend: {
            colors: {
                // Contextual Color System
                primary: {
                    DEFAULT: '#000000', // bg-primary = pure black
                    50: '#e6f4f9',
                    100: '#cce9f3',
                    200: '#99d3e7',
                    300: '#66bddb',
                    400: '#3E93C9', // Main blue accent
                    500: '#357eb0',
                    600: '#2c6997',
                    700: '#23547e',
                    800: '#1a3f65',
                    900: '#112a4c',
                },
                surface: {
                    primary: '#000000',    // Main background
                    secondary: '#0a0a0a',  // Elevated surfaces
                    tertiary: '#111111',   // Cards, panels
                    elevated: '#1a1a1a',   // Modals, dropdowns
                },
                border: {
                    primary: 'rgba(255, 255, 255, 0.1)',   // border-primary
                    secondary: 'rgba(255, 255, 255, 0.05)', // border-secondary
                    accent: '#3E93C9',                       // border-accent
                },
                secondary: {
                    50: '#f8fafc',
                    100: '#f1f5f9',
                    200: '#e2e8f0',
                    300: '#cbd5e1',
                    400: '#94a3b8',
                    500: '#64748b',
                    600: '#475569',
                    700: '#334155',
                    800: '#1e293b',
                    900: '#0f172a',
                },
                accent: {
                    50: '#f0f9ff',
                    100: '#e0f2fe',
                    200: '#bae6fd',
                    300: '#7dd3fc',
                    400: '#38bdf8',
                    500: '#0ea5e9',
                    600: '#0284c7',
                    700: '#0369a1',
                    800: '#075985',
                    900: '#0c4a6e',
                },
            },
            fontFamily: {
                sans: ['var(--font-inter)', 'Inter', 'system-ui', 'sans-serif'],
                mono: ['JetBrains Mono', 'monospace'],
            },
            spacing: {
                '18': '4.5rem',
                '88': '22rem',
            },
            backgroundColor: {
                'app-primary': '#000000',
                'app-secondary': '#0a0a0a',
                'app-tertiary': '#111111',
                'app-elevated': '#1a1a1a',
                'app-card': 'rgba(17, 17, 17, 0.5)',
            },
            borderColor: {
                'app-primary': 'rgba(255, 255, 255, 0.1)',
                'app-secondary': 'rgba(255, 255, 255, 0.05)',
                'app-accent': '#3E93C9',
            },
            animation: {
                'fade-in': 'fadeIn 0.5s ease-in-out',
                'slide-up': 'slideUp 0.3s ease-out',
                'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
            },
            keyframes: {
                fadeIn: {
                    '0%': { opacity: '0' },
                    '100%': { opacity: '1' },
                },
                slideUp: {
                    '0%': { transform: 'translateY(10px)', opacity: '0' },
                    '100%': { transform: 'translateY(0)', opacity: '1' },
                },
            },
        },
    },
    plugins: [],
}

export default config
