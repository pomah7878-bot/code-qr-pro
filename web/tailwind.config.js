/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{vue,js}'],
  theme: {
    extend: {
      colors: {
        ink: { 950: '#070b18', 900: '#0b1122', 800: '#111a33', 700: '#1a2547' },
        brand: { 400: '#818cf8', 500: '#6366f1', 600: '#4f46e5' },
        accent: { 400: '#22d3ee', 500: '#06b6d4' }
      },
      fontFamily: {
        display: ['Unbounded', 'sans-serif'],
        sans: ['Inter', 'sans-serif']
      }
    }
  },
  plugins: []
};
