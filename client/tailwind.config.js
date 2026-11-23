/** @type {import('tailwindcss').Config} */
const v = (n) => `rgb(var(--${n}) / <alpha-value>)`;
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: { sans: ['Inter', 'ui-sans-serif', 'system-ui', 'Segoe UI', 'Roboto', 'sans-serif'] },
      colors: {
        bg: v('bg'),
        surface: v('surface'),
        subtle: v('subtle'),
        border: v('border'),
        fg: v('fg'),
        muted: v('muted'),
        faint: v('faint'),
        accent: { DEFAULT: v('accent'), fg: v('accent-fg'), soft: v('accent-soft') },
        success: { DEFAULT: v('success'), soft: v('success-soft') },
        warning: { DEFAULT: v('warning'), soft: v('warning-soft') },
        danger: { DEFAULT: v('danger'), soft: v('danger-soft') },
        info: { DEFAULT: v('info'), soft: v('info-soft') },
      },
      borderRadius: { DEFAULT: '8px', lg: '10px', xl: '12px' },
      boxShadow: {
        card: '0 1px 2px rgb(0 0 0 / 0.04), 0 1px 1px rgb(0 0 0 / 0.02)',
        pop: '0 8px 24px rgb(0 0 0 / 0.12), 0 2px 6px rgb(0 0 0 / 0.06)',
      },
      transitionDuration: { DEFAULT: '150ms' },
    },
  },
  plugins: [],
};
