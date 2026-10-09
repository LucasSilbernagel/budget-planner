import type {
	ForecastingResult,
	ForecastingScenario,
} from '@budget-planner/core/finance/forecasting'
import type React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Card } from '@/components/ui/Card'
import { usePremiumAccess } from '../../hooks/usePremiumAccess'
import {
	deleteForecast,
	type ForecastWire,
	fetchForecasts,
	fetchProfiles,
	saveForecast,
	updateForecast,
} from '../../lib/forecasting/forecast-api'
import { FORECAST_SAVE_VERSION } from '../../lib/forecasting/forecast-version'
import { todayBaseline, withTodayBaseline } from '../../lib/forecasting/today-baseline'
import { PremiumPrompt } from '../auth/premium-prompt'
import { ForecastList } from './forecast-list'
import { LoadingSpinner } from './forecasting-page/loading-spinner'
import { PageFooter } from './forecasting-page/page-footer'
import { PageHeader } from './forecasting-page/page-header'
import { type ForecastingTab, tabId, tabPanelId } from './forecasting-page/tab-ids'
import { TabNavigation } from './forecasting-page/tab-navigation'
import { ProjectionChart } from './projection-chart'
import { mapToSavedForecast, type SavedForecast, type ScenarioInputs } from './saved-forecast'
import { ScenarioBuilder } from './scenario-builder'
import { useCurrentForecastData } from './scenario-builder/useCurrentForecastData'

/** Only `none` means "create a profile". */
type ProfileAvailability =
	| { kind: 'loading' }
	| { kind: 'ready'; profileId: string }
	| { kind: 'none' }
	| { kind: 'error' }

export function ForecastingPage(): React.ReactElement {
	const { status } = usePremiumAccess()
	const [activeTab, setActiveTab] = useState<ForecastingTab>('scenarios')
	const [scenarioResult, setScenarioResult] = useState<ForecastingResult | null>(null)
	// A saved forecast's stored baseline came from its own rows, so it is never shown.
	const today = useCurrentForecastData()
	const [loadedForecast, setLoadedForecast] = useState<SavedForecast | null>(null)
	// Bumped on every Load so the builder remounts even when the SAME forecast is
	// re-loaded (an id-only key would not change → stale edits would survive).
	const [loadNonce, setLoadNonce] = useState(0)
	// Separate from `loadedForecast` on purpose: that one keys the builder's remount.
	const [saveTarget, setSaveTarget] = useState<{ id: string; name: string } | null>(null)

	// Retires the save confirmation so it can't outlive what it describes.
	const handleTabChange = useCallback((tab: ForecastingTab) => {
		setSaveSuccess(null)
		setActiveTab(tab)
	}, [])

	const [serverForecasts, setServerForecasts] = useState<ForecastWire[]>([])
	// Only `none` means "create a profile"; keying a prompt on anything else would mislead
	// during every load and on network errors.
	const [profileState, setProfileState] = useState<ProfileAvailability>({ kind: 'loading' })
	const defaultProfileId = profileState.kind === 'ready' ? profileState.profileId : null
	// Rendered by the page: the builder is CSS-hidden after a save switches tabs, so a
	// confirmation there would be invisible.
	const [saveSuccess, setSaveSuccess] = useState<string | null>(null)
	// Locks the tab strip during a save so its failure alert isn't hidden. Set only from the
	// builder's `finally`, so it can never latch.
	const [isSavingForecast, setIsSavingForecast] = useState(false)

	useEffect(() => {
		const loadData = async () => {
			try {
				const profilesResult = await fetchProfiles()
				let resolvedProfileId: string | null = null
				if (!profilesResult.success) {
					// Not "no profile": 401, 403 and 503 all land here for accounts that may have profiles.
					setProfileState({ kind: 'error' })
				} else if (!Array.isArray(profilesResult.data)) {
					// A malformed success is an error, not an empty account.
					setProfileState({ kind: 'error' })
				} else if (profilesResult.data.length === 0) {
					// The only branch that means the account genuinely has no profile.
					setProfileState({ kind: 'none' })
				} else {
					const defaultProfile =
						profilesResult.data.find((p) => p.isDefault) ?? profilesResult.data[0]
					// Guard on the id: the `?? [0]` fallback makes the element always truthy.
					if (defaultProfile?.id) {
						resolvedProfileId = defaultProfile.id
						setProfileState({ kind: 'ready', profileId: defaultProfile.id })
					} else {
						setProfileState({ kind: 'error' })
					}
				}

				// Load saved forecasts scoped to the same profile saves target, so the
				// "My Forecasts" list and the save destination stay consistent.
				const result = await fetchForecasts(resolvedProfileId ?? undefined)
				if (result.success && result.data) {
					setServerForecasts(result.data)
				}
			} catch (error) {
				// A throw is a network failure: an error, never the "no profile" arm.
				console.error('Failed to load forecasting data:', error)
				// Only demote an unresolved state: this try also wraps the forecast-list fetch, which
				// must not flip a good `ready` to `error`.
				setProfileState((current) => (current.kind === 'loading' ? { kind: 'error' } : current))
			}
		}

		if (status.hasAccess && status.isAuthenticated) {
			loadData()
		}
	}, [status.hasAccess, status.isAuthenticated])

	const handleSaveForecast = useCallback(
		async (forecast: {
			name: string
			description?: string
			scenario: ForecastingScenario
			result: ForecastingResult
			inputs: ScenarioInputs
		}): Promise<{ success: boolean; error?: string }> => {
			// A new attempt retires the previous confirmation, so a failed retry can
			// never sit beside a stale "Saved ..." banner.
			setSaveSuccess(null)
			// Last line of defence: the builder already disables Save for `none` and `error`.
			if (!defaultProfileId) {
				const error =
					profileState.kind === 'loading'
						? 'Still checking your financial profiles. Try again in a moment.'
						: profileState.kind === 'error'
							? 'We could not check your financial profiles, so the forecast was not saved.'
							: 'No financial profile found. Create a profile before saving forecasts.'
				// Not user feedback — the builder surfaces the returned `error`. Kept
				// because it is the only record that a save was refused before it began.
				console.error('Cannot save forecast:', error)
				return { success: false, error }
			}
			try {
				const input = {
					name: forecast.name,
					description: forecast.description,
					scenarioData: {
						scenario: forecast.scenario,
						result: forecast.result,
						inputs: forecast.inputs,
					},
					profileId: defaultProfileId,
				}

				// Same (trimmed) name as the forecast last loaded or saved: save over it; any other name
				// creates a new forecast.
				const isUpdate = saveTarget !== null && forecast.name.trim() === saveTarget.name
				const result = isUpdate
					? await updateForecast(saveTarget.id, {
							name: input.name,
							description: input.description,
							scenarioData: input.scenarioData,
							version: FORECAST_SAVE_VERSION,
						})
					: await saveForecast({ ...input, version: FORECAST_SAVE_VERSION })

				if (result.success && result.data) {
					setSaveTarget({ id: String(result.data.id), name: result.data.name })
					const getResult = await fetchForecasts(defaultProfileId)

					if (getResult.success && getResult.data) {
						setServerForecasts(getResult.data)
					}
					// The tab switch is silent for assistive tech, so the confirmation is announced.
					setSaveSuccess(forecast.name)
					setActiveTab('saved')
					return { success: true }
				}

				// Deleted elsewhere: drop the save target and refetch the list; a failed refetch must not
				// replace the 404's message.
				if (isUpdate && 'status' in result && result.status === 404) {
					setSaveTarget(null)
					const listResult = await fetchForecasts(defaultProfileId).catch(() => null)
					if (listResult?.success && listResult.data) {
						setServerForecasts(listResult.data)
					}
				}
				const error = result.error || 'Failed to save forecast'
				console.error('Failed to save forecast:', error)
				return { success: false, error }
			} catch (error) {
				const message = error instanceof Error ? error.message : 'Failed to save forecast'
				console.error('Failed to save forecast:', error)
				return { success: false, error: message }
			}
		},
		[defaultProfileId, profileState.kind, saveTarget]
	)

	// Bulk delete overlaps per-id reloads; only the newest may replace the list.
	const latestDeleteReload = useRef(0)

	const handleDeleteForecast = useCallback(
		async (id: string) => {
			setSaveSuccess(null)
			try {
				const result = await deleteForecast(id)

				if (result.success) {
					// A deleted forecast is no longer the save target, so the next Save creates a new one.
					setSaveTarget((target) => (target?.id === id ? null : target))
					const reload = ++latestDeleteReload.current
					const getResult = await fetchForecasts(defaultProfileId ?? undefined)

					if (reload === latestDeleteReload.current && getResult.success && getResult.data) {
						setServerForecasts(getResult.data)
					}
				} else {
					console.error('Failed to delete forecast:', result.error)
				}
			} catch (error) {
				console.error('Failed to delete forecast:', error)
			}
		},
		[defaultProfileId]
	)

	const handleLoadForecast = useCallback(
		(forecast: SavedForecast) => {
			setSaveSuccess(null)
			setLoadedForecast(forecast)
			setSaveTarget({ id: forecast.id, name: forecast.name })
			setLoadNonce((n) => n + 1)
			// Never the stored baseline; `null` until today's data is ready.
			setScenarioResult(withTodayBaseline(forecast.result, today.data))
			setActiveTab('scenarios')
		},
		[today.data]
	)

	const savedForecasts = useMemo(
		() => serverForecasts.map(mapToSavedForecast).filter((f): f is SavedForecast => f !== null),
		[serverForecasts]
	)
	// Ending net worth vs today's data projected flat over the same years.
	const vsTodayById = useMemo(() => {
		const byId = new Map<string, number>()
		for (const forecast of savedForecasts) {
			const end = todayBaseline(today.data, forecast.result.projection.length)?.at(-1)?.netWorth
			if (end !== undefined) byId.set(forecast.id, forecast.result.summary.endingNetWorth - end)
		}
		return byId
	}, [savedForecasts, today.data])

	if (status.isLoading) {
		return (
			<main className="flex items-center justify-center min-h-screen">
				<LoadingSpinner />
			</main>
		)
	}

	if (!status.hasAccess) {
		return (
			<main className="min-h-screen surface-sunken flex items-center justify-center p-4">
				{/* The free-user test's regex control matches both featureName and the benefit <li>;
            rewording both makes that test vacuous. */}
				<PremiumPrompt
					featureName="Advanced Forecasting"
					message="See how a raise, rising bills, a big one-off cost, paying down a loan or saving more each month would change your finances over the years ahead — and save each scenario to reopen later."
					asDialog={false}
				/>
			</main>
		)
	}

	return (
		<div className="min-h-screen surface-sunken">
			<PageHeader />

			<main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
				{/* Name only situations the engine reads: growth rates and signed one-time events (a house
            deposit yes, a mortgage no). No positional wording: the intro renders on every tab. */}
				<p data-testid="forecasting-intro" className="text-body mb-6 max-w-3xl">
					Wondering how a raise, steadily rising bills, a big one-off cost, paying down a loan or
					saving more each month would change things? Build it out here and see how your finances
					track over the years ahead.
				</p>

				<div className="mb-8">
					<TabNavigation
						activeTab={activeTab}
						onTabChange={handleTabChange}
						disabled={isSavingForecast}
					/>
				</div>

				{/* Outside the tab panel: a save switches tabs, hiding the builder. Polite, no focus. */}
				{saveSuccess && (
					<div
						data-testid="save-success"
						role="status"
						aria-live="polite"
						className="mb-6 rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800 dark:border-green-800 dark:bg-green-900/30 dark:text-green-300"
					>
						Saved "{saveSuccess}" to My Forecasts.
					</div>
				)}

				<Card className="rounded-xl shadow-lg p-4 sm:p-8">
					{/* The builder stays mounted (hidden) so switching tabs doesn't wipe unsaved edits. */}
					{/* All panel wrappers always render so every tab's `aria-controls` target exists. */}
					<div
						role="tabpanel"
						id={tabPanelId('scenarios')}
						aria-labelledby={tabId('scenarios')}
						className={activeTab === 'scenarios' ? '' : 'hidden'}
					>
						<ScenarioBuilder
							// Remount (resetting all internal state) on every Load — including
							// re-loading the same forecast — so the builder re-seeds from it.
							key={`${loadedForecast?.id ?? 'new'}-${loadNonce}`}
							initialForecast={loadedForecast}
							onSave={handleSaveForecast}
							onResultChange={setScenarioResult}
							saveAvailability={{ kind: profileState.kind }}
							onSavingChange={setIsSavingForecast}
						/>
					</div>

					<div
						role="tabpanel"
						id={tabPanelId('projections')}
						aria-labelledby={tabId('projections')}
						className={activeTab === 'projections' ? '' : 'hidden'}
					>
						{activeTab === 'projections' && <ProjectionChart result={scenarioResult} />}
					</div>

					<div
						role="tabpanel"
						id={tabPanelId('saved')}
						aria-labelledby={tabId('saved')}
						className={activeTab === 'saved' ? '' : 'hidden'}
					>
						{activeTab === 'saved' && (
							<ForecastList
								forecasts={savedForecasts}
								vsToday={vsTodayById}
								onDelete={handleDeleteForecast}
								onLoad={handleLoadForecast}
							/>
						)}
					</div>
				</Card>

				<PageFooter />
			</main>
		</div>
	)
}
