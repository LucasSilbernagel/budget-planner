import React from 'react'

export function HomePage() {
  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto">
        <header className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Budget Planner</h1>
          <p className="text-gray-600 mt-2">
            Track your income and expenses with ease
          </p>
        </header>

        <main className="space-y-6">
          <section className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-xl font-semibold text-gray-800 mb-4">
              Welcome to Budget Planner
            </h2>
            <p className="text-gray-600 mb-4">
              Start tracking your finances by navigating to the income or expenses pages.
            </p>
            <div className="flex gap-4">
              <a
                href="/income"
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
              >
                Income
              </a>
              <a
                href="/expenses"
                className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 transition-colors"
              >
                Expenses
              </a>
            </div>
          </section>

          <section className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-xl font-semibold text-gray-800 mb-4">
              Quick Stats
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-gray-50 rounded-lg p-4">
                <p className="text-sm text-gray-500">Total Income</p>
                <p className="text-2xl font-bold text-green-600">$0.00</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-4">
                <p className="text-sm text-gray-500">Total Expenses</p>
                <p className="text-2xl font-bold text-red-600">$0.00</p>
              </div>
            </div>
          </section>
        </main>

        <footer className="mt-8 pt-4 border-t border-gray-200 text-center text-sm text-gray-500">
          <p>Budget Planner - Built with TanStack Start & React 19</p>
        </footer>
      </div>
    </div>
  )
}
