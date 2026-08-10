import { render, screen } from '@/test/utils'
import { describe, expect, it } from 'vitest'
import { MarkdownRenderer } from '../markdown-renderer'

/**
 * MarkdownRenderer tests (story 4-10, AC-2).
 *
 * Verifies that raw Markdown strings (as loaded from the static `.md` files)
 * are rendered to real HTML elements: headings, lists, and links — including
 * safe handling of external links.
 */
describe('MarkdownRenderer', () => {
  it('renders Markdown headings as heading elements', () => {
    render(<MarkdownRenderer content={'## Section title'} />)
    expect(screen.getByRole('heading', { name: 'Section title' })).toBeInTheDocument()
  })

  it('renders Markdown lists as list items', () => {
    render(<MarkdownRenderer content={'- First\n- Second\n- Third'} />)
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
    expect(screen.getByText('Second')).toBeInTheDocument()
  })

  it('renders internal Markdown links as same-tab anchors', () => {
    render(<MarkdownRenderer content={'See the [FAQ](/docs/faq) page.'} />)
    const link = screen.getByRole('link', { name: 'FAQ' })
    expect(link).toHaveAttribute('href', '/docs/faq')
    expect(link).not.toHaveAttribute('target')
  })

  it('renders external Markdown links with new-tab safety attributes', () => {
    render(<MarkdownRenderer content={'[Source](https://example.com/repo)'} />)
    const link = screen.getByRole('link', { name: 'Source' })
    expect(link).toHaveAttribute('href', 'https://example.com/repo')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('treats protocol-relative links as external (off-site, new-tab safety)', () => {
    render(<MarkdownRenderer content={'[CDN](//cdn.example.com/x)'} />)
    const link = screen.getByRole('link', { name: 'CDN' })
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('renders fenced code blocks as code elements', () => {
    render(<MarkdownRenderer content={'```\npnpm install\n```'} />)
    expect(screen.getByText('pnpm install')).toBeInTheDocument()
  })

  /**
   * Theming guard (story 31-1, AC-2).
   *
   * `prose` appears in exactly one place in the codebase — this component — and
   * it governs every heading, paragraph, link, inline `code`, fenced `pre`,
   * blockquote, `hr` and table border across `/docs/*`, `/terms`, `/privacy`,
   * `/refund` and `/pricing`. All three importers are in this story's scope, so
   * `dark:prose-invert` is unconditional rather than an opt-in prop.
   */
  it('inverts the typography plugin in dark mode without dropping the light theme', () => {
    const { container } = render(<MarkdownRenderer content={'# Title'} />)
    const article = container.querySelector('article')
    if (!article) throw new Error('missing article')
    const tokens = [...article.classList]

    expect(tokens).toContain('prose')
    expect(tokens).toContain('prose-slate')
    expect(tokens).toContain('dark:prose-invert')
    expect(tokens).toContain('max-w-none')
  })
})
