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
                // Brand color scheme
                // #000000  — base black
                // #060606  — elevated dark
                // #081717  — card / teal-tinted dark
                // #35c889  — primary green accent
                // #a4a4ff  — secondary lavender accent
                brand: {
                    green: '#35c889',
                    lavender: '#a4a4ff',
                },
                primary: {
                    DEFAULT: '#000000',
                    400: '#35c889',
                    500: '#2db377',
                    600: '#259966',
                },
                surface: {
                    primary: '#000000',
                    secondary: '#060606',
                    tertiary: '#081717',
                    elevated: '#0c1f1f',
                },
                border: {
                    primary: 'rgba(255, 255, 255, 0.08)',
                    secondary: 'rgba(255, 255, 255, 0.04)',
                    accent: '#35c889',
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
                'app-secondary': '#060606',
                'app-tertiary': '#081717',
                'app-elevated': '#0c1f1f',
                'app-card': 'rgba(8, 23, 23, 0.6)',
            },
            borderColor: {
                'app-primary': 'rgba(255, 255, 255, 0.08)',
                'app-secondary': 'rgba(255, 255, 255, 0.04)',
                'app-accent': '#35c889',
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
