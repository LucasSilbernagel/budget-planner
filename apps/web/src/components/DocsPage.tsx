import { createFileRoute } from '@tanstack/react-router'
import React from 'react'

// Documentation content (in a real app, this would be loaded from markdown files)
const docsContent: Record<string, { title: string; content: JSX.Element }> = {
  gettingStarted: {
    title: 'Getting Started',
    content: (
      <div className="space-y-4">
        <p>Welcome to Budget Planner! This guide will help you get started.</p>

        <h3 className="text-lg font-semibold text-gray-800">Creating Your First Income Source</h3>
        <ol className="list-decimal list-inside space-y-2">
          <li>Navigate to the Income page</li>
          <li>Click "Add Income Source"</li>
          <li>Enter a name (e.g., Salary, Freelance)</li>
          <li>Enter the amount in dollars</li>
          <li>Select a frequency (weekly, biweekly, monthly, annually)</li>
          <li>Click "Add Income Source"</li>
        </ol>

        <h3 className="text-lg font-semibold text-gray-800">Adding Expenses</h3>
        <p>Similar to income sources, you can add expenses on the Expenses page.</p>
      </div>
    ),
  },
  features: {
    title: 'Features',
    content: (
      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-gray-800">Free Tier Features</h3>
        <ul className="list-disc list-inside space-y-2">
          <li>Income and expense tracking</li>
          <li>Client-side data persistence (localStorage)</li>
          <li>Basic visualizations</li>
          <li>Savings goal tracking</li>
          <li>Balance tracking for investments and debts</li>
        </ul>

        <h3 className="text-lg font-semibold text-gray-800">Premium Features</h3>
        <ul className="list-disc list-inside space-y-2">
          <li>Multi-device synchronization</li>
          <li>Custom user profiles</li>
          <li>Premium forecasting tools</li>
          <li>Advanced financial projections</li>
          <li>Currency customization</li>
        </ul>
      </div>
    ),
  },
  faq: {
    title: 'Frequently Asked Questions',
    content: (
      <div className="space-y-4">
        <div>
          <h4 className="font-medium text-gray-800">How do I reset my data?</h4>
          <p className="text-gray-600">
            For free tier users with client-side storage, you can clear your data by clearing your
            browser's localStorage. In Chrome: Settings &gt; Privacy &gt; Clear browsing data &gt;
            Local Storage.
          </p>
        </div>
        <div>
          <h4 className="font-medium text-gray-800">Can I import/export my data?</h4>
          <p className="text-gray-600">
            Data import/export functionality is planned for a future release. Currently, data is
            stored locally for free tier users.
          </p>
        </div>
        <div>
          <h4 className="font-medium text-gray-800">How are calculations performed?</h4>
          <p className="text-gray-600">
            All financial calculations are performed using integer arithmetic with values stored in
            cents for precision. Visualizations use normalized values for consistent comparisons.
          </p>
        </div>
      </div>
    ),
  },
}

// Extract all document IDs
const docIds = Object.keys(docsContent)

export const DocsPage = () => {
  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto">
        <header className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Documentation</h1>
          <p className="text-gray-600 mt-2">Learn how to use Budget Planner effectively</p>
        </header>

        <main className="space-y-6">
          {/* Documentation Navigation */}
          <section className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-xl font-semibold text-gray-800 mb-4">Documentation Index</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {docIds.map((id) => (
                <a
                  key={id}
                  href={`/docs/${id}`}
                  className="block bg-gray-50 rounded-lg p-4 hover:bg-gray-100 transition-colors"
                >
                  <h3 className="font-medium text-blue-600">{docsContent[id].title}</h3>
                </a>
              ))}
            </div>
          </section>

          {/* Welcome Message */}
          <section className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-xl font-semibold text-gray-800 mb-4">
              Welcome to Budget Planner Documentation
            </h2>
            <p className="text-gray-600">
              Select a documentation page from the index above to get started. This documentation
              system is built using TanStack Router for seamless navigation between documentation
              pages.
            </p>
          </section>

          {/* Additional Resources */}
          <section className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-xl font-semibold text-gray-800 mb-4">Additional Resources</h2>
            <div className="flex gap-4">
              <a
                href="https://github.com/lucassilbernagel/budget-planner"
                target="_blank"
                rel="noopener noreferrer"
                className="px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300 transition-colors"
              >
                View Source Code
              </a>
              <a
                href="https://github.com/lucassilbernagel/budget-planner/issues"
                target="_blank"
                rel="noopener noreferrer"
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
              >
                Report Issue
              </a>
            </div>
          </section>
        </main>

        {/* Navigation */}
        <div className="mt-8 flex gap-4">
          <a
            href="/"
            className="px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300 transition-colors"
          >
            Back to Home
          </a>
        </div>
      </div>
    </div>
  )
}

// Create route for docs index
export const docsRoute = createFileRoute('/docs')({
  component: DocsPage,
})

// Create a dynamic route for specific docs pages
export const docRoute = createFileRoute('/docs/$docId')({
  component: DocPage,
})

// Specific documentation page component
function DocPage() {
  const { docId } = docsRoute.useParams()

  // Get the documentation content
  const doc = docsContent[docId]

  if (!doc) {
    return (
      <div className="min-h-screen bg-gray-50 p-8">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-2xl font-bold text-gray-900">Documentation Not Found</h1>
          <p className="text-gray-600 mt-2">The requested documentation page does not exist.</p>
          <a
            href="/docs"
            className="inline-block mt-4 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
          >
            Back to Documentation Index
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto">
        <header className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">{doc.title}</h1>
          <p className="text-gray-600 mt-2">Budget Planner Documentation</p>
        </header>

        <main className="bg-white rounded-lg shadow-md p-6">
          <div className="prose max-w-none">{doc.content}</div>
        </main>

        <div className="mt-6 flex gap-4">
          <a
            href="/docs"
            className="px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300 transition-colors"
          >
            Back to Documentation Index
          </a>
          <a
            href="/"
            className="px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300 transition-colors"
          >
            Back to Home
          </a>
        </div>
      </div>
    </div>
  )
}
