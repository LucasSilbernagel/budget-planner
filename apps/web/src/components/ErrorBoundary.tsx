import { Component, type ErrorInfo, type ReactNode } from 'react'

export interface ErrorBoundaryProps {
	children: ReactNode
	fallback?: ReactNode
	onError?: (error: Error, errorInfo: ErrorInfo) => void
}

interface ErrorBoundaryState {
	hasError: boolean
	errorMessage: string | null
}

function sanitizeErrorMessage(error: Error): string {
	const sensitivePatterns = [
		/at \w+ \(/g,
		/\.tsx:\d+:\d+/g,
		/\.ts:\d+:\d+/g,
		/\.jsx:\d+:\d+/g,
		/\.js:\d+:\d+/g,
	]

	let message = error.message

	for (const pattern of sensitivePatterns) {
		message = message.replace(pattern, '')
	}

	if (!message || message.length < 10) {
		return 'An unexpected error occurred'
	}

	return message
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
	constructor(props: ErrorBoundaryProps) {
		super(props)
		this.state = {
			hasError: false,
			errorMessage: null,
		}
	}

	static getDerivedStateFromError(error: Error): ErrorBoundaryState {
		return {
			hasError: true,
			errorMessage: sanitizeErrorMessage(error),
		}
	}

	override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
		console.error('ErrorBoundary caught an error:', error, errorInfo)

		this.props.onError?.(error, errorInfo)
	}

	override render(): ReactNode {
		if (this.state.hasError) {
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
