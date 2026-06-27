import type { LegalPage } from '../../content/legal'
import { MarkdownRenderer } from '../docs/markdown-renderer'
import { LegalPageLayout } from './legal-page-layout'

/**
 * Renders one legal/commercial page (story 5-13).
 *
 * Composes the lean `LegalPageLayout` header/landmark with the shared
 * `MarkdownRenderer` (reused from the docs system, story 4-10) so there is a
 * single Markdown rendering stack across the app. Each top-level route
 * (`/pricing`, `/terms`, `/privacy`, `/refund`) is a thin wrapper that renders
 * this view with its page object, which keeps the route files trivial and makes
 * the page content unit-testable without the generated route tree.
 */

export interface LegalPageViewProps {
  page: LegalPage
}

export function LegalPageView({ page }: LegalPageViewProps) {
  return (
    <LegalPageLayout title={page.title} description={page.description}>
      <MarkdownRenderer content={page.content} />
    </LegalPageLayout>
  )
}
