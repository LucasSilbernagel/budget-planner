/**
 * Login Page
 *
 * Page for user authentication via Paddle.
 * Provides entry point for new users to sign up and existing users to log in.
 *
 * Route: /login
 *
 * Data Sovereignty: Redirects to Paddle (UK-based) for authentication
 */

import { PaddleAuthButton } from '@/components/auth/paddle-button'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/login')({
  component: LoginPage,
})

function LoginPage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-md">
        {/* Logo / Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Budget Planner</h1>
          <p className="text-gray-600 mt-2">Track your finances with privacy and control</p>
        </div>

        {/* Auth Card */}
        <div className="bg-white shadow-md rounded-2xl p-8 border border-gray-200">
          <div className="text-center">
            <h2 className="text-2xl font-semibold text-gray-900 mb-2">Welcome</h2>
            <p className="text-gray-600 mb-6">
              Sign in to access premium features and sync your data across devices
            </p>
          </div>

          {/* Paddle Authentication Button */}
          <div className="space-y-4">
            <PaddleAuthButton className="w-full" />

            <div className="text-center text-sm text-gray-500">
              <p>
                By signing in, you agree to our{' '}
                <a href="/terms" className="text-blue-600 hover:underline">
                  Terms of Service
                </a>{' '}
                and{' '}
                <a href="/privacy" className="text-blue-600 hover:underline">
                  Privacy Policy
                </a>
              </p>
            </div>
          </div>

          {/* Free Tier Notice */}
          <div className="mt-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
            <h3 className="font-medium text-gray-900 mb-1">Free Tier Available</h3>
            <p className="text-sm text-gray-600">
              You can also use Budget Planner without an account. Your data will be stored locally
              on this device only.
            </p>
            <a
              href="/"
              className="inline-block mt-2 text-sm text-blue-600 hover:text-blue-700 font-medium"
            >
              Continue without account →
            </a>
          </div>
        </div>

        {/* Footer */}
        <p className="mt-8 text-sm text-gray-500 text-center">
          © {new Date().getFullYear()} Budget Planner. All rights reserved.
        </p>
      </div>
    </div>
  )
}
