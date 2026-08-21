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
                brand: {
                    green: '#ffffff',
                    lavender: '#d4d4d4',
                },
                primary: {
                    DEFAULT: '#0a0a0a',
                    400: '#fafafa',
                    500: '#f5f5f5',
                    600: '#e5e5e5',
                },
                surface: {
                    primary: '#0a0a0a',
                    secondary: '#111111',
                    tertiary: '#171717',
                    elevated: '#1a1a1a',
                },
                border: {
                    primary: 'rgba(255, 255, 255, 0.12)',
                    secondary: 'rgba(255, 255, 255, 0.08)',
                    accent: 'rgba(255, 255, 255, 0.25)',
                },
            },
            fontFamily: {
                sans: ['"Space Grotesk"', 'system-ui', 'sans-serif'],
                mono: ['"Space Grotesk"', 'system-ui', 'sans-serif'],
            },
            spacing: {
                '18': '4.5rem',
                '88': '22rem',
            },
            backgroundColor: {
                'app-primary': '#0a0a0a',
                'app-secondary': '#111111',
                'app-tertiary': '#171717',
                'app-elevated': '#1a1a1a',
                'app-card': '#111111',
            },
            borderColor: {
                'app-primary': 'rgba(255, 255, 255, 0.12)',
                'app-secondary': 'rgba(255, 255, 255, 0.08)',
                'app-accent': 'rgba(255, 255, 255, 0.25)',
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
