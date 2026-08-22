/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef9ff', 100: '#d8f1ff', 200: '#b9e8ff', 300: '#89dbff',
          400: '#51c5ff', 500: '#29a7ff', 600: '#0d8bf5', 700: '#0672d4',
          800: '#0b5dab', 900: '#104f86', 950: '#0f3151',
        },
        dark: {
          50: '#f6f6f7', 100: '#e2e2e5', 200: '#c4c5cb', 300: '#9fa0a9',
          400: '#7b7c87', 500: '#61626e', 600: '#4d4d57', 700: '#3f3f47',
          800: '#27272f', 900: '#1a1a21', 950: '#101014',
        },
      },
    },
  },
  plugins: [],
};
