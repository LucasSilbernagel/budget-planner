import React, { Component, ErrorInfo, ReactNode } from 'react'

/**
 * Error Boundary Props
 */
export interface ErrorBoundaryProps {
  children: ReactNode
  fallback?: ReactNode
  onError?: (error: Error, errorInfo: ErrorInfo) => void
}

/**
 * Error Boundary State
 */
interface ErrorBoundaryState {
  hasError: boolean
  errorMessage: string | null
}

/**
 * Sanitizes error messages for display to users
 * Removes potentially sensitive information
 */
function sanitizeErrorMessage(error: Error): string {
  // List of sensitive patterns to remove
  const sensitivePatterns = [
    /at \w+ \(/g, // "at functionName ("
    /\.tsx:\d+:\d+/g, // file locations
    /\.ts:\d+:\d+/g,
    /\.jsx:\d+:\d+/g,
    /\.js:\d+:\d+/g,
  ]

  let message = error.message

  // Remove sensitive information
  sensitivePatterns.forEach((pattern) => {
    message = message.replace(pattern, '')
  })

  // If message is now empty or too generic, use a standard message
  if (!message || message.length < 10) {
    return 'An unexpected error occurred'
  }

  return message
}

/**
 * Error Boundary component
 * Catches JavaScript errors anywhere in the component tree, logs those errors,
 * and displays a fallback UI.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = {
      hasError: false,
      errorMessage: null,
    }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    // Update state so the next render will show the fallback UI
    // Store sanitized message, not raw error
    return {
      hasError: true,
      errorMessage: sanitizeErrorMessage(error),
    }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // Log the full error to error reporting service (server-side)
    console.error('ErrorBoundary caught an error:', error, errorInfo)

    // Call optional error handler with sanitized message
    this.props.onError?.(error, errorInfo)
  }

  render(): ReactNode {
    if (this.state.hasError) {
      // Fallback UI if provided, otherwise show default error message
      if (this.props.fallback) {
        return this.props.fallback
      }

      return (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700" role="alert">
          <h3 className="font-semibold mb-2">Something went wrong</h3>
          <p className="text-sm">
            An error occurred while rendering this component. Please try again or contact support if
            the problem persists.
          </p>
          {this.state.errorMessage && (
            <details className="mt-2 text-xs">
              <summary>Error details</summary>
              <p className="text-red-800 mt-1">{this.state.errorMessage}</p>
            </details>
          )}
        </div>
      )
    }

    return this.props.children
  }
}

export default ErrorBoundary
