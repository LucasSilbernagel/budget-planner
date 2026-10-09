// Read at render time so tests can stub it with vi.stubEnv.
export function getFormId(): string {
	return (import.meta.env.VITE_FORMSPARK_FORM_ID ?? '').trim()
}
