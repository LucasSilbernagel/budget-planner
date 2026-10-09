import { createFileRoute } from '@tanstack/react-router'
import { ForecastingPage } from '../components/forecasting/forecasting-page'

export const Route = createFileRoute('/forecasting')({
	head: () => ({
		meta: [
			{ title: 'Forecasting · Longhand Budget' },
			{
				/* Keep in step with the intro and the PremiumPrompt message: only name situations the
           engine reads (growth rates and signed one-time events). */
				name: 'description',
				content:
					'Model how a raise, rising bills, a one-off cost, paying down a loan or saving more each month changes your finances over the years ahead — with saved, reloadable scenarios.',
			},
		],
	}),
	component: ForecastingPage,
})
