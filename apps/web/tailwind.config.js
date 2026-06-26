import typography from '@tailwindcss/typography'

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {},
  },
  // `typography` provides the `prose` classes used to style rendered
  // documentation markdown (story 4-10).
  plugins: [typography],
}
