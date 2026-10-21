import type { Config } from 'tailwindcss';

/**
 * Paleta institucional de la Universidad Cooperativa de Colombia:
 * azul marino #132740, cian #00ACC9, verde lima #80BA27 y amarillo #FFCE36.
 * El lenguaje visual es el de la coleccion de referencia "gradient colored UI kit":
 * superficies blancas difusas, acentos con degradado de marca y geometria squircle.
 */
const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primario: {
          50: '#F2F5F9',
          100: '#E3E9F0',
          200: '#C4D0E0',
          300: '#94A9C4',
          400: '#5D7BA3',
          500: '#3A5480',
          600: '#27405F',
          700: '#132740',
          800: '#0F2036',
          900: '#0B1727',
          950: '#060D18',
        },
        acento: {
          50: '#ECFCFE',
          100: '#CFF6FA',
          200: '#9AEDF4',
          300: '#5FDEEC',
          400: '#2BCBE0',
          500: '#00ACC9',
          600: '#0091AB',
          700: '#00788E',
          800: '#066072',
          900: '#0A515F',
          950: '#00303A',
        },
        lima: {
          100: '#EBF7D8',
          200: '#D7EFB1',
          300: '#BEE181',
          400: '#A3CE58',
          500: '#80BA27',
          600: '#689E1D',
          700: '#527D19',
        },
        neutro: {
          50: '#F8F9F9',
          100: '#EFEFEF',
          200: '#E1E1E1',
          300: '#C9C9C9',
          400: '#A0A0A0',
          500: '#707070',
          600: '#5F5E5E',
          700: '#484848',
          800: '#323232',
          900: '#1F1F1F',
          950: '#121212',
        },
        exito: {
          100: '#DCF6EA',
          200: '#B4ECD4',
          300: '#7FD9B3',
          500: '#17976A',
          600: '#12795A',
          700: '#0F6047',
          900: '#0A3D2E',
        },
        aviso: {
          100: '#FDF6E0',
          200: '#FAE7B8',
          300: '#FFE08A',
          500: '#F5B700',
          600: '#B26A00',
          700: '#8A5200',
          900: '#573300',
        },
        error: {
          100: '#FCE4E2',
          200: '#F8C9C5',
          300: '#F0A09A',
          500: '#E0483C',
          600: '#C0302A',
          700: '#96241F',
          900: '#5F1512',
        },
      },
      fontFamily: {
        sans: ['Montserrat', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
      },
      fontSize: {
        xs: ['0.75rem', { lineHeight: '1.4' }],
        sm: ['0.8125rem', { lineHeight: '1.4' }],
        base: ['0.9375rem', { lineHeight: '1.5' }],
        md: ['1rem', { lineHeight: '1.5' }],
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
      borderRadius: {
        '2xl': '1.25rem',
        '3xl': '1.5rem',
        '4xl': '2rem',
      },
      backgroundImage: {
        marca: 'var(--gradient-marca)',
        'marca-horizontal': 'var(--gradient-marca-horizontal)',
        'marca-suave': 'var(--gradient-marca-suave)',
        exito: 'var(--gradient-exito)',
        aviso: 'var(--gradient-aviso)',
        error: 'var(--gradient-error)',
        acento: 'var(--gradient-acento)',
        malla: 'var(--gradient-malla)',
        fondo: 'var(--gradient-fondo)',
      },
      boxShadow: {
        tarjeta: '0 2px 6px rgba(19, 39, 64, 0.12), 0 10px 24px rgba(19, 39, 64, 0.1)',
        elevada: '0 10px 30px rgba(19, 39, 64, 0.18)',
        hundida:
          'inset 2px 2px 6px rgba(19, 39, 64, 0.14), inset -2px -2px 6px rgba(255, 255, 255, 0.9)',
        resultado: '0 12px 32px rgba(19, 39, 64, 0.16)',
        marca: '0 10px 28px rgba(19, 39, 64, 0.32)',
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
