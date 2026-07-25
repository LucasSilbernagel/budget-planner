import { createFileRoute } from '@tanstack/react-router'
import { DocsIndex } from '../../components/docs/docs-index'
import { DocsLayout } from '../../components/docs/docs-layout'

/**
 * Documentation index route — `/docs` (story 4-10, AC-1).
 */
export const Route = createFileRoute('/docs/')({
  component: DocsIndexPage,
})

function DocsIndexPage() {
  return (
    <DocsLayout
      title="Documentation"
      description="Guides and answers for getting the most out of SoluBudget."
    >
      <DocsIndex />
    </DocsLayout>
  )
}
