/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontSize: {
        // Bump all standard Tailwind text sizes up slightly
        'xs': ['13px', { lineHeight: '18px' }],
        'sm': ['14px', { lineHeight: '20px' }],
        'base': ['15px', { lineHeight: '22px' }],
        'lg': ['16px', { lineHeight: '24px' }],
      },
      colors: {
        brand: {
          50: '#eef9ff', 100: '#d8f1ff', 200: '#b9e8ff', 300: '#89dbff',
          400: '#51c5ff', 500: '#29a7ff', 600: '#0d8bf5', 700: '#0672d4',
          800: '#0b5dab', 900: '#104f86', 950: '#0f3151',
        },
        dark: {
          50: 'rgb(var(--dark-50) / <alpha-value>)',
          100: 'rgb(var(--dark-100) / <alpha-value>)',
          200: 'rgb(var(--dark-200) / <alpha-value>)',
          300: 'rgb(var(--dark-300) / <alpha-value>)',
          400: 'rgb(var(--dark-400) / <alpha-value>)',
          500: 'rgb(var(--dark-500) / <alpha-value>)',
          600: 'rgb(var(--dark-600) / <alpha-value>)',
          700: 'rgb(var(--dark-700) / <alpha-value>)',
          800: 'rgb(var(--dark-800) / <alpha-value>)',
          900: 'rgb(var(--dark-900) / <alpha-value>)',
          950: 'rgb(var(--dark-950) / <alpha-value>)',
        },
      },
    },
  },
  plugins: [],
};
