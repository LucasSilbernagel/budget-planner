import { HttpResponse, http } from 'msw'

export const handlers = [
	http.post(/^https?:\/\/submit-form\.com\//, () =>
		HttpResponse.json({ success: true }, { status: 200 })
	),

	http.all(/^https?:\/\/([^/]+\.)?counter\.dev\//, () => new HttpResponse(null, { status: 204 })),

	http.post('https://api.brevo.com/v3/smtp/email', () =>
		HttpResponse.json({ messageId: 'msw-mock-message-id' }, { status: 201 })
	),

	// Anchored to the host so `notpaddle.com.evil.test` does not match.
	http.all(/^https?:\/\/([^/]+\.)?paddle\.com\//, () =>
		HttpResponse.json({
			mocked: true,
			data: {},
			meta: { request_id: 'msw-mock-request' },
		})
	),
]
