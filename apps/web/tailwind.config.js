import typography from '@tailwindcss/typography'

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{js,ts,jsx,tsx}'],
  // Media dark strategy (story 61.1, FR93). Every `dark:` variant follows the
  // device's `prefers-color-scheme` directly.
  //
  // Story 7-3 had moved this to `'class'` so an in-app toggle could drive a
  // `.dark` class on `<html>`; story 61.1 REVERSED that decision — the device
  // preference is now the app's only theme input, the toggle and its whole
  // persistence chain (store, provider, <head> bootstrap, CSP hash) are deleted,
  // and nothing anywhere adds a `.dark` class.
  //
  // ⚠️ This setting governs the `dark:` UTILITIES ONLY. A hand-written `.dark …`
  // selector in `styles/global.css` would keep compiling and never match. There
  // is exactly one place that ever mattered — the page canvas — and it is now an
  // `@media (prefers-color-scheme: dark)` block. Grep `global.css` for `.dark`
  // before assuming this line is the whole story.
  darkMode: 'media',
  theme: {
    extend: {},
  },
  // `typography` provides the `prose` classes used to style rendered
  // documentation markdown (story 4-10).
  plugins: [typography],
}
