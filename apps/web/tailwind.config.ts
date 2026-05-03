import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-geist-sans)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-geist-mono)', 'ui-monospace', 'monospace'],
      },
      colors: {
        background: '#09090b',
        foreground: '#fafafa',
        accent: '#3b82f6',
      },
      keyframes: {
        'fade-in': { '0%': { opacity: '0', transform: 'translateY(8px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
        'fade-in-slow': { '0%': { opacity: '0', transform: 'translateY(16px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
        shimmer: { '0%': { backgroundPosition: '-200% 0' }, '100%': { backgroundPosition: '200% 0' } },
        pulse: { '0%, 100%': { opacity: '1' }, '50%': { opacity: '0.5' } },
        marquee: { '0%': { transform: 'translateX(0)' }, '100%': { transform: 'translateX(-50%)' } },
        'glow-pulse': {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(16,185,129,0.35)' },
          '50%': { boxShadow: '0 0 0 14px rgba(16,185,129,0)' },
        },
        'gradient-shift': {
          '0%, 100%': { backgroundPosition: '0% 50%' },
          '50%': { backgroundPosition: '100% 50%' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-6px)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.4s ease-out',
        'fade-in-slow': 'fade-in-slow 0.7s ease-out',
        shimmer: 'shimmer 2s linear infinite',
        marquee: 'marquee 40s linear infinite',
        'glow-pulse': 'glow-pulse 2.4s ease-out infinite',
        'gradient-shift': 'gradient-shift 8s ease infinite',
        float: 'float 4s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};

export default config;
