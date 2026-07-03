import typography from '@tailwindcss/typography'

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{js,ts,jsx,tsx}'],
  // Class-based dark strategy (story 7-3, FR23). The 223 pre-existing `dark:`
  // variants previously followed the OS `prefers-color-scheme` (Tailwind's
  // default `media` strategy); they now respond to a `.dark` class on `<html>`
  // that the in-app theme toggle drives. This is a deliberate behavior change:
  // dark mode is opt-in via the premium toggle rather than OS-driven, so free
  // users (who never toggle) stay light regardless of their OS setting (AC-3/AC-5).
  darkMode: 'class',
  theme: {
    extend: {},
  },
  // `typography` provides the `prose` classes used to style rendered
  // documentation markdown (story 4-10).
  plugins: [typography],
}
