import {
	DEFAULT_FORECAST_YEARS,
	type ForecastingResult,
	type ForecastingScenario,
	isValidForecastYears,
} from '@budget-planner/core'
import type { Frequency } from '@budget-planner/core/finance'
import { createFileRoute } from '@tanstack/react-router'
import type React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PremiumPrompt } from '../components/auth/premium-prompt'
import { ForecastList } from '../components/forecasting/forecast-list'
import { ProjectionChart } from '../components/forecasting/projection-chart'
import { ScenarioBuilder, useCurrentForecastData } from '../components/forecasting/scenario-builder'
import { usePremiumAccess } from '../hooks/usePremiumAccess'
import {
	deleteForecast,
	type ForecastWire,
	fetchForecasts,
	fetchProfiles,
	saveForecast,
	updateForecast,
} from '../lib/forecasting/forecast-api'
import { FORECAST_SAVE_VERSION } from '../lib/forecasting/forecast-version'
import { todayBaseline, withTodayBaseline } from '../lib/forecasting/today-baseline'
import { isKnownFrequency } from '../lib/readable-rows'

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

type ForecastingTab = 'scenarios' | 'projections' | 'saved'

/** Money in cents. */
export type SavedSavingsAccount = {
	name: string
	balance: number
	monthlyContribution: number
}

/** Money in cents; `balance` is a positive magnitude for both types. */
export type SavedBalanceAccount = {
	name: string
	type: 'investment' | 'debt'
	balance: number
	contribution: number
	frequency: Frequency
	/** Legacy (pre-v5) debts were saved `false`; the builder reloads those flagged, by `version`. */
	contributionRecordedAsExpense: boolean
	annualReturn?: number
	paidByExpenseName?: string
}

/** Money in cents. */
export type SavedAssetAccount = {
	name: string
	balance: number
}

/**
 * `savings`/`investments` are still written as the rows' sums so older cached clients reopen
 * at the right start; on load the rows win when they disagree.
 */
export type ScenarioInputs = {
	savings: number
	investments: number
	years: number
	savingsAccounts?: SavedSavingsAccount[]
	balanceAccounts?: SavedBalanceAccount[]
	assetAccounts?: SavedAssetAccount[]
}

/** Only `none` means "create a profile". */
type ProfileAvailability =
	| { kind: 'loading' }
	| { kind: 'ready'; profileId: string }
	| { kind: 'none' }
	| { kind: 'error' }

export type SavedForecast = {
	id: string
	name: string
	description?: string
	scenario: ForecastingScenario
	result: ForecastingResult
	inputs?: ScenarioInputs
	version?: number
	createdAt: string
	updatedAt: string
}

/** Coerced like the builder's `itemsFromSaved`; `unknown` because a client wrote the JSON. */
function savedSavingsAccount(entry: unknown): SavedSavingsAccount {
	const record =
		typeof entry === 'object' && entry !== null ? (entry as Record<string, unknown>) : {}
	const money = (value: unknown) =>
		typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
	return {
		name: typeof record['name'] === 'string' ? record['name'] : '',
		balance: money(record['balance']),
		monthlyContribution: money(record['monthlyContribution']),
	}
}

/**
 * Returns null for a row that is neither investment nor debt: its sign is unknowable.
 * The legacy debt-flag rule needs `version`, so the builder applies it, not this.
 */
function savedBalanceAccount(entry: unknown): SavedBalanceAccount | null {
	const record =
		typeof entry === 'object' && entry !== null ? (entry as Record<string, unknown>) : {}
	const type = record['type']
	if (type !== 'investment' && type !== 'debt') return null
	const money = (value: unknown) =>
		typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
	const frequency = record['frequency']
	return {
		name: typeof record['name'] === 'string' ? record['name'] : '',
		type,
		balance: money(record['balance']),
		contribution: money(record['contribution']),
		frequency: isKnownFrequency(frequency) ? frequency : 'monthly',
		contributionRecordedAsExpense: record['contributionRecordedAsExpense'] === true,
		...(type === 'debt' &&
		typeof record['paidByExpenseName'] === 'string' &&
		record['paidByExpenseName'].trim() !== ''
			? { paidByExpenseName: record['paidByExpenseName'].trim() }
			: {}),
		...(type === 'investment' &&
		typeof record['annualReturn'] === 'number' &&
		Number.isFinite(record['annualReturn'])
			? { annualReturn: record['annualReturn'] }
			: {}),
	}
}

function savedAssetAccount(entry: unknown): SavedAssetAccount {
	const record =
		typeof entry === 'object' && entry !== null ? (entry as Record<string, unknown>) : {}
	const balance = record['balance']
	return {
		name: typeof record['name'] === 'string' ? record['name'] : '',
		balance: typeof balance === 'number' && Number.isFinite(balance) && balance >= 0 ? balance : 0,
	}
}

function mapToSavedForecast(profile: ForecastWire): SavedForecast | null {
	try {
		const parsed = JSON.parse(profile.scenarioData) as {
			scenario?: ForecastingScenario
			result?: ForecastingResult
			inputs?: Omit<ScenarioInputs, 'savingsAccounts' | 'balanceAccounts' | 'assetAccounts'> & {
				savingsAccounts?: unknown
				balanceAccounts?: unknown
				assetAccounts?: unknown
			}
		}
		if (!parsed?.scenario || !parsed?.result?.summary) {
			return null
		}
		// Only a bad `years` is replaced, never the whole `inputs`: dropping inputs would
		// re-baseline the reopened forecast to 0. Rows win when their sum disagrees with `savings`.
		const savedInputs = parsed.inputs
		const savingsAccounts = Array.isArray(savedInputs?.savingsAccounts)
			? savedInputs.savingsAccounts.map(savedSavingsAccount)
			: undefined
		const savings = savingsAccounts
			? savingsAccounts.reduce((sum, account) => sum + account.balance, 0)
			: savedInputs?.savings
		const balanceAccounts = Array.isArray(savedInputs?.balanceAccounts)
			? savedInputs.balanceAccounts
					.map(savedBalanceAccount)
					.filter((account): account is SavedBalanceAccount => account !== null)
			: undefined
		const investments = balanceAccounts
			? balanceAccounts.reduce(
					(sum, account) => (account.type === 'investment' ? sum + account.balance : sum),
					0
				)
			: savedInputs?.investments
		const assetAccounts = Array.isArray(savedInputs?.assetAccounts)
			? savedInputs.assetAccounts.map(savedAssetAccount)
			: undefined
		const inputs: ScenarioInputs | undefined =
			savedInputs &&
			typeof savings === 'number' &&
			Number.isFinite(savings) &&
			typeof investments === 'number' &&
			Number.isFinite(investments)
				? {
						savings,
						investments,
						years: isValidForecastYears(savedInputs.years)
							? savedInputs.years
							: DEFAULT_FORECAST_YEARS,
						...(savingsAccounts ? { savingsAccounts } : {}),
						...(balanceAccounts ? { balanceAccounts } : {}),
						...(assetAccounts ? { assetAccounts } : {}),
					}
				: undefined
		return {
			id: String(profile.id),
			name: profile.name,
			description: profile.description ?? undefined,
			scenario: parsed.scenario,
			result: parsed.result,
			inputs,
			version: profile.version,
			// Re-serialising turns an unparseable date into a throw, so the row is skipped, not "Invalid Date".
			createdAt: new Date(profile.createdAt).toISOString(),
			updatedAt: new Date(profile.updatedAt).toISOString(),
		}
	} catch {
		return null
	}
}

function ForecastingPage(): React.ReactElement {
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

				<div className="surface rounded-xl shadow-lg p-4 sm:p-8">
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
				</div>

				<PageFooter />
			</main>
		</div>
	)
}

function PageHeader(): React.ReactElement {
	return (
		<header className="surface border-b border-default sticky top-0 z-10">
			<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
				<div className="flex items-center justify-between">
					{/* No subtitle and no Premium badge, deliberately: the header is sticky and the intro
              does the explaining. */}
					<div>
						<h1 className="text-2xl font-bold text-subheading">Financial Forecasting</h1>
					</div>
				</div>
			</div>
		</header>
	)
}

type TabNavigationProps = {
	activeTab: ForecastingTab
	onTabChange: (tab: ForecastingTab) => void
	disabled?: boolean
}

const tabs: { id: ForecastingTab; label: string }[] = [
	{ id: 'scenarios', label: 'Scenario Builder' },
	{ id: 'projections', label: 'Projections' },
	{ id: 'saved', label: 'My Forecasts' },
]

// Static ids are safe: the page renders one tab strip, and they stay SSR-stable.
const tabId = (tab: ForecastingTab): string => `forecasting-tab-${tab}`
const tabPanelId = (tab: ForecastingTab): string => `forecasting-panel-${tab}`

/**
 * Phone-only: drops icons and padding so three tabs fit 320px; `min-w-0` lets larger
 * fonts squeeze the buttons instead of scrolling the page sideways.
 */
const TAB_BUTTON_PHONE_CLASS = 'max-sm:flex-1 max-sm:min-w-0 max-sm:px-1.5'
const TAB_CONTENT_CLASS = 'flex items-center max-sm:justify-center max-sm:text-center'
const TAB_ICON_PHONE_CLASS = 'max-sm:hidden'
/** Phone only: a word wider than its button breaks rather than overflowing the neighbour. */
const TAB_LABEL_CLASS = 'ml-2 max-sm:ml-0 max-sm:[overflow-wrap:anywhere]'

/**
 * WAI-ARIA tabs with automatic activation and roving tabIndex. The tablist must stay the
 * direct parent of the buttons; tests locate the strip that way.
 */
function TabNavigation({
	activeTab,
	onTabChange,
	disabled = false,
}: TabNavigationProps): React.ReactElement {
	const tabRefs = useRef<(HTMLButtonElement | null)[]>([])

	const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
		if (disabled) return
		// A held modifier belongs to the browser or AT (Alt+Arrow is Back/Forward): never swallow it.
		if (event.altKey || event.ctrlKey || event.metaKey) return
		const current = tabs.findIndex((tab) => tab.id === activeTab)
		let target: number
		switch (event.key) {
			case 'ArrowRight':
				target = (current + 1) % tabs.length
				break
			case 'ArrowLeft':
				target = (current - 1 + tabs.length) % tabs.length
				break
			case 'Home':
				target = 0
				break
			case 'End':
				target = tabs.length - 1
				break
			default:
				return
		}
		event.preventDefault()
		const next = tabs[target]
		if (!next) return
		onTabChange(next.id)
		tabRefs.current[target]?.focus()
	}

	return (
		<div className="flex flex-col sm:flex-row gap-4">
			<div
				role="tablist"
				aria-label="Forecasting views"
				onKeyDown={handleKeyDown}
				className="flex space-x-1 bg-gray-100 dark:bg-gray-700 rounded-lg p-1"
			>
				{tabs.map((tab, index) => (
					<button
						key={tab.id}
						ref={(element) => {
							tabRefs.current[index] = element
						}}
						type="button"
						role="tab"
						id={tabId(tab.id)}
						aria-selected={activeTab === tab.id}
						aria-controls={tabPanelId(tab.id)}
						tabIndex={activeTab === tab.id ? 0 : -1}
						onClick={() => onTabChange(tab.id)}
						disabled={disabled}
						className={`px-4 ${TAB_BUTTON_PHONE_CLASS} py-2 text-sm font-medium rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed ${
							activeTab === tab.id
								? 'bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 shadow-sm'
								: 'text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 hover:text-gray-700 dark:hover:text-gray-100'
						}`}
					>
						<span className={TAB_CONTENT_CLASS}>
							{getTabIcon(tab.id, activeTab === tab.id)}
							<span className={TAB_LABEL_CLASS}>{tab.label}</span>
						</span>
					</button>
				))}
			</div>
		</div>
	)
}

function getTabIcon(tabId: ForecastingTab, isActive: boolean): React.ReactElement {
	const className = `w-4 h-4 ${TAB_ICON_PHONE_CLASS} ${
		isActive ? 'text-blue-600' : 'text-gray-400'
	}`

	switch (tabId) {
		case 'scenarios':
			return <ScenarioIcon className={className} />
		case 'projections':
			return <ChartIcon className={className} />
		case 'saved':
			return <SaveIcon className={className} />
		default:
			return <div className={className} />
	}
}

function PageFooter(): React.ReactElement {
	return (
		<footer className="mt-8 pt-6 border-t border-default text-center">
			<p className="text-xs text-faint">
				Forecasts calculated in your browser • Saved forecasts stored in Germany (EU)
			</p>
		</footer>
	)
}

function LoadingSpinner(): React.ReactElement {
	return (
		<div className="flex items-center justify-center space-x-2">
			<div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
			<span className="text-body">Loading...</span>
		</div>
	)
}

function ScenarioIcon({ className }: { className: string }): React.ReactElement {
	return (
		<svg
			aria-hidden="true"
			className={className}
			fill="none"
			stroke="currentColor"
			viewBox="0 0 24 24"
		>
			<path
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeWidth={2}
				d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
			/>
		</svg>
	)
}

function ChartIcon({ className }: { className: string }): React.ReactElement {
	return (
		<svg
			aria-hidden="true"
			className={className}
			fill="none"
			stroke="currentColor"
			viewBox="0 0 24 24"
		>
			<path
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeWidth={2}
				d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a2 2 0 01-2 2H6a2 2 0 01-2-2V4z"
			/>
		</svg>
	)
}

function SaveIcon({ className }: { className: string }): React.ReactElement {
	return (
		<svg
			aria-hidden="true"
			className={className}
			fill="none"
			stroke="currentColor"
			viewBox="0 0 24 24"
		>
			<path
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeWidth={2}
				d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4"
			/>
		</svg>
	)
}
