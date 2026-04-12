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
                // Brand color scheme (dark + chartreuse primary)
                // #000000  — base black
                // Surfaces unified to #000000 (flat black UI)
                // #efe752  — primary accent
                // #f5ec99  — secondary soft yellow
                brand: {
                    green: '#efe752', // key kept for existing `brand-green` usage
                    lavender: '#f5ec99',
                },
                primary: {
                    DEFAULT: '#000000',
                    400: '#efe752',
                    500: '#e5dd4a',
                    600: '#d4cc48',
                },
                surface: {
                    primary: '#000000',
                    secondary: '#000000',
                    tertiary: '#000000',
                    elevated: '#000000',
                },
                border: {
                    primary: 'rgba(255, 255, 255, 0.08)',
                    secondary: 'rgba(255, 255, 255, 0.04)',
                    accent: '#efe752',
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
                sans: ['JetBrains Mono', 'monospace'],
                mono: ['JetBrains Mono', 'monospace'],
            },
            spacing: {
                '18': '4.5rem',
                '88': '22rem',
            },
            backgroundColor: {
                'app-primary': '#000000',
                'app-secondary': '#000000',
                'app-tertiary': '#000000',
                'app-elevated': '#000000',
                'app-card': '#000000',
            },
            borderColor: {
                'app-primary': 'rgba(255, 255, 255, 0.08)',
                'app-secondary': 'rgba(255, 255, 255, 0.04)',
                'app-accent': '#efe752',
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
