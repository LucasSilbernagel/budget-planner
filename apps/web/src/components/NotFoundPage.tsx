import { Link } from '@tanstack/react-router'

// Rendered inside the root route's Outlet, which already supplies the footer and shell.
export function NotFoundPage() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-4 sm:p-8">
      <div className="mx-auto max-w-6xl">
        <header className="mb-8">
          <p className="text-3xl font-bold text-gray-900 dark:text-gray-100">Longhand Budget</p>
        </header>

        <main className="flex flex-col items-center py-16 text-center sm:py-24">
          <p className="text-base font-semibold text-blue-600 dark:text-blue-400">404</p>
          <h1 className="mt-4 text-3xl font-bold text-gray-900 dark:text-gray-100 sm:text-4xl">
            Page not found
          </h1>
          <p className="mt-4 max-w-md text-gray-600 dark:text-gray-400">
            Sorry, we couldn’t find the page you’re looking for.
          </p>
          <Link
            to="/"
            className="mt-8 inline-block rounded-lg bg-blue-600 px-6 py-3 font-medium text-white shadow-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900"
          >
            Go home
          </Link>
        </main>
      </div>
    </div>
  )
}
