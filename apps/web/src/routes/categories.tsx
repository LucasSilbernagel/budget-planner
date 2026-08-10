import { CategoriesPage } from '@/components/categories/CategoriesPage'
import { createFileRoute } from '@tanstack/react-router'

/**
 * Premium category management — `/categories` (story 30.4b, FR54).
 *
 * Thin route wrapper: the page lives in `components/categories/CategoriesPage.tsx`
 * so this module exports only `Route` and stays code-splittable.
 *
 * Deliberately absent from `GlobalNav` — the nav is already tight at 320px, and
 * `GlobalNav`'s `NavPath` is a closed union that a new entry would have to widen.
 * `/settings` carries the (gated) entry point, following `/report` and
 * `/profiles`, so this is reachable without being a nav orphan.
 */
export const Route = createFileRoute('/categories')({
  head: () => ({ meta: [{ title: 'Categories · Longhand Budget' }] }),
  component: CategoriesPage,
})
