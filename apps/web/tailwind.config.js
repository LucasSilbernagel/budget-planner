import typography from '@tailwindcss/typography'

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{js,ts,jsx,tsx}'],
  // Governs `dark:` utilities only: a hand-written `.dark` selector in global.css would never match.
  darkMode: 'media',
  theme: {
    extend: {},
  },
  plugins: [typography],
}
