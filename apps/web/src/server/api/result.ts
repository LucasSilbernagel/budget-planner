export type ApiResult<T> = {
	success: boolean
	data?: T
	error?: string
}
