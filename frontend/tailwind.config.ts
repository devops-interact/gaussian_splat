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
                // #08080f  — elevated dark
                // #0d0b1a  — card / purple-tinted dark
                // #7c3aed  — primary purple accent
                // #a78bfa  — secondary lavender accent
                brand: {
                    green: '#7c3aed', // Keeping the key name the same so we don't break existing classes if any used `brand-green`
                    lavender: '#a78bfa',
                },
                primary: {
                    DEFAULT: '#000000',
                    400: '#7c3aed',
                    500: '#6d28d9',
                    600: '#5b21b6',
                },
                surface: {
                    primary: '#000000',
                    secondary: '#08080f',
                    tertiary: '#0d0b1a',
                    elevated: '#1a1425',
                },
                border: {
                    primary: 'rgba(255, 255, 255, 0.08)',
                    secondary: 'rgba(255, 255, 255, 0.04)',
                    accent: '#7c3aed',
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
                'app-secondary': '#08080f',
                'app-tertiary': '#0d0b1a',
                'app-elevated': '#1a1425',
                'app-card': 'rgba(13, 11, 26, 0.6)',
            },
            borderColor: {
                'app-primary': 'rgba(255, 255, 255, 0.08)',
                'app-secondary': 'rgba(255, 255, 255, 0.04)',
                'app-accent': '#7c3aed',
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
