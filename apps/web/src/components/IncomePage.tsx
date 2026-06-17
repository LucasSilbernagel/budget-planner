import React from 'react'

export function IncomePage() {
  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto">
        <header className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Income</h1>
          <p className="text-gray-600 mt-2">
            Manage your income sources and track your earnings
          </p>
        </header>

        <main className="bg-white rounded-lg shadow-md p-6">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-semibold text-gray-800">
              Income Sources
            </h2>
            <button className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors">
              Add Income
            </button>
          </div>

          <div className="bg-gray-50 rounded-lg p-4 text-center py-12">
            <p className="text-gray-500 mb-4">No income sources yet</p>
            <p className="text-sm text-gray-400">
              Click "Add Income" to get started
            </p>
          </div>

          <div className="mt-6 flex gap-4">
            <a
              href="/"
              className="px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300 transition-colors"
            >
              Back to Home
            </a>
            <a
              href="/expenses"
              className="px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300 transition-colors"
            >
              View Expenses
            </a>
          </div>
        </main>
      </div>
    </div>
  )
}
