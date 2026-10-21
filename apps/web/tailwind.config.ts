import type { Config } from 'tailwindcss';

/**
 * Paleta institucional propia: azul petroleo como primario, grises pizarra como
 * neutros y colores semanticos funcionales (verde exito, ambar duplicado,
 * rojo error). No se usan degradados ni tonos morados o indigos.
 */
const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primario: {
          50: '#F2F8FA',
          100: '#DCEEF2',
          200: '#B7DCE4',
          300: '#8AC4D1',
          400: '#4E9AAC',
          500: '#1B6E80',
          600: '#145A6A',
          700: '#12505E',
          800: '#0E3D48',
          900: '#0B2B33',
        },
        neutro: {
          50: '#F7F9FA',
          100: '#EEF1F3',
          200: '#E1E6E9',
          300: '#C6CDD2',
          400: '#9AA5AC',
          500: '#6B767D',
          600: '#525C63',
          700: '#3A4249',
          800: '#262C31',
          900: '#16191C',
        },
        exito: {
          100: '#DCF2E6',
          300: '#8FD3AF',
          500: '#2C9463',
          600: '#1E7A4B',
          700: '#175F3B',
        },
        aviso: {
          100: '#FDF0D9',
          300: '#F2C878',
          500: '#D18700',
          600: '#B26A00',
          700: '#8B5200',
        },
        error: {
          100: '#FBE3E1',
          300: '#EF9B94',
          500: '#CE3A31',
          600: '#B3261E',
          700: '#8C1C16',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
      },
      fontSize: {
        xs: ['0.75rem', { lineHeight: '1.4' }],
        sm: ['0.8125rem', { lineHeight: '1.4' }],
        base: ['0.9375rem', { lineHeight: '1.45' }],
        md: ['1rem', { lineHeight: '1.45' }],
        lg: ['1.125rem', { lineHeight: '1.35' }],
        xl: ['1.25rem', { lineHeight: '1.3' }],
        '2xl': ['1.5rem', { lineHeight: '1.25' }],
        '3xl': ['1.875rem', { lineHeight: '1.2' }],
      },
      spacing: {
        toque: '48px',
      },
      minHeight: {
        toque: '48px',
      },
      minWidth: {
        toque: '48px',
      },
      boxShadow: {
        tarjeta: '0 1px 2px rgba(11, 43, 51, 0.08), 0 1px 3px rgba(11, 43, 51, 0.06)',
        elevada: '0 4px 12px rgba(11, 43, 51, 0.12)',
        resultado: '0 8px 24px rgba(11, 43, 51, 0.18)',
      },
      borderRadius: {
        '4xl': '1.25rem',
      },
      keyframes: {
        'entrada-resultado': {
          '0%': { opacity: '0', transform: 'translateY(-8px) scale(0.98)' },
          '100%': { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        'pulso-suave': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.65' },
        },
      },
      animation: {
        'entrada-resultado': 'entrada-resultado 180ms ease-out',
        'pulso-suave': 'pulso-suave 1.6s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};

export default config;
