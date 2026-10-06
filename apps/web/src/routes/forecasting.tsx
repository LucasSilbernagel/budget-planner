/**
 * Forecasting Page Route
 *
 * Premium feature route for advanced financial forecasting tools.
 * Provides scenario modeling and saved, reloadable net-worth forecasts.
 *
 * Route: /forecasting
 * Access: Premium users only (paid tier)
 *
 * Architecture: TanStack Start file-based routing with React
 * Data Sovereignty: Forecasts are computed client-side; saved forecasts are
 * stored in DanubeData (Germany - EU).
 */

import {
  DEFAULT_FORECAST_YEARS,
  type ForecastingResult,
  type ForecastingScenario,
  isValidForecastYears,
} from '@budget-planner/core'
import type { Frequency } from '@budget-planner/core/finance'
import { createFileRoute } from '@tanstack/react-router'
import React, { useState, useEffect, useCallback } from 'react'
import { PremiumPrompt } from '../components/auth/premium-prompt'
import { ForecastList } from '../components/forecasting/forecast-list'
import { ProjectionChart } from '../components/forecasting/projection-chart'
import { ScenarioBuilder } from '../components/forecasting/scenario-builder'
import { usePremiumAccess } from '../hooks/usePremiumAccess'
import {
  type ForecastWire,
  deleteForecast,
  fetchForecasts,
  fetchProfiles,
  saveForecast,
  updateForecast,
} from '../lib/forecasting/forecast-api'
import { FORECAST_SAVE_VERSION } from '../lib/forecasting/forecast-version'
import { isKnownFrequency } from '../lib/readable-rows'

// ============================================================================
// Route Configuration
// ============================================================================

/**
 * ⚠️ THIS ROUTE HAS NO `loader`, AND THAT IS THE FIX, NOT AN OMISSION.
 *
 * It used to carry one that destructured `request` from the loader context —
 * which has no such property, so `request` was `undefined` at runtime. It then
 * called `checkPremiumAccessServer(undefined)`, whose first act is
 * `request.headers.get('cookie')` (`api/auth/paddle.ts:168`); that threw, the
 * function's own `try/catch` swallowed it, and the loader returned `null`.
 *
 * Every branch of that loader returned `null`, nothing read `Route.useLoaderData()`
 * for this route, and the throw happened before any DB access — so the whole thing
 * was a dynamic import and a guaranteed exception on every navigation to
 * `/forecasting`, for no observable effect. Removing it is behaviour-preserving.
 *
 * Premium gating for this page is client-side and unchanged: `ForecastingPage`
 * gates on `usePremiumAccess`, which is the fail-closed path that actually works.
 * The removed loader never granted or denied anything.
 */
export const Route = createFileRoute('/forecasting')({
  head: () => ({
    meta: [
      { title: 'Forecasting · Longhand Budget' },
      {
        /* ⚠️ Keep this in step with the `forecasting-intro` paragraph and the
           free user's `PremiumPrompt` message below — all three describe the
           same mechanism to different audiences, and story 57.1 rewrote only
           the intro, leaving these two promising a vaguer, bigger tool than
           the engine is. Every situation named here must be expressible by
           what `calculateFinancialForecast` actually READS: the two growth
           rates and `oneTimeEvents` (signed since `forecast-1`, so an outflow
           counts). A house MORTGAGE and an early retirement are still out —
           each needs a recurring change dated to a chosen year, and recurring
           items carry no start/end year.
           ⚠️ That rule is a JUDGEMENT the tests only SPOT-CHECK: the guard in
           `forecasting-intro.test.tsx` denies exactly two phrases (`mortgage`,
           `early retirement`). "A new car loan from 2030" or "retiring at 55"
           would sail through it. Apply the rule yourself; do not read a green
           suite as proof a new situation is modellable. */
        name: 'description',
        content:
          'Model how a raise, rising bills, a one-off cost, paying down a loan or saving more each month changes your finances over the years ahead — with saved, reloadable scenarios.',
      },
    ],
  }),
  component: ForecastingPage,
})

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Tab options for the forecasting page
 */
type ForecastingTab = 'scenarios' | 'projections' | 'saved'

/**
 * One what-if savings row as a saved forecast stores it (story 100.1). Money in
 * cents.
 */
export interface SavedSavingsAccount {
  name: string
  balance: number
  monthlyContribution: number
}

/**
 * One what-if investment or debt row as a saved forecast stores it (story
 * 100.2). Money in cents; `balance` is a positive magnitude for both types and
 * `contribution` is the amount at `frequency` cadence.
 *
 * `annualReturn` (story 100.3, version 4) is a decimal (0.06 = 6%), written on
 * INVESTMENT rows only. Absent on every v1-v3 row and on every debt row; the
 * builder then uses `DEFAULT_INVESTMENT_RETURN` (6%, D3), so a forecast saved
 * before 100.3 reopens lower than it was saved (computed at 7%).
 */
export interface SavedBalanceAccount {
  name: string
  type: 'investment' | 'debt'
  balance: number
  contribution: number
  frequency: Frequency
  /**
   * Investment: "Not taken from the money left over" (45.1). Debt (story 102.2,
   * version 5): "Payment already in Expenses"; every v1-v4 debt was saved `false`
   * under 100.2 D4, and the builder reloads those flagged (it reads `version`).
   */
  contributionRecordedAsExpense: boolean
  /** Investment rows saved since story 100.3 (version 4) only. */
  annualReturn?: number
  /** Debt rows saved since story 102.2 (version 5) only: the seeded payment's Expenses row. */
  paidByExpenseName?: string
}

/**
 * Builder inputs that are NOT part of ForecastingScenario but are needed to
 * faithfully reopen a saved forecast (savings/investments/years). Persisted in
 * the scenarioData JSON blob alongside { scenario, result } (story bug-3).
 *
 * ⚠️ `savings` is still written beside `savingsAccounts` (story 100.1, D4), as
 * their sum: an older cached client (PWA) reads only `savings`, and must still
 * reopen a v2 forecast at the right starting figure. On load the ROWS win when
 * the two disagree (D7, `mapToSavedForecast`). `investments` is likewise written
 * beside `balanceAccounts` (story 100.2) as the INVESTMENT rows' sum, with the
 * same rows-win rule. (An older client that reads only `investments` reopens a v3
 * forecast without its debts and contributions; its starting investments are
 * still right.) Since story 100.3 (version 4) each investment row also carries
 * its own `annualReturn`.
 */
export interface ScenarioInputs {
  savings: number
  investments: number
  years: number
  /** Absent on forecasts saved before story 100.1 (version 1). */
  savingsAccounts?: SavedSavingsAccount[]
  /** Absent on forecasts saved before story 100.2 (versions 1 and 2). */
  balanceAccounts?: SavedBalanceAccount[]
}

/**
 * Whether this account has a profile that a forecast can be saved to.
 *
 * ⚠️⚠️ Four arms, because the single `string | null` this replaced conflated
 * five distinct situations and the UI could only guess between them. `ready`
 * carries the id so nothing has to re-derive it, and `none` is the ONLY arm that
 * means "create a profile".
 */
type ProfileAvailability =
  | { kind: 'loading' }
  | { kind: 'ready'; profileId: string }
  | { kind: 'none' }
  | { kind: 'error' }

/**
 * Saved forecast with metadata
 */
export interface SavedForecast {
  id: string
  name: string
  description?: string
  scenario: ForecastingScenario
  result: ForecastingResult
  /**
   * Starting inputs the scenario type doesn't carry (savings/investments/years,
   * since story 100.1 the savings rows, and since story 100.2 the investment and
   * debt rows). Optional because forecasts saved
   * before story bug-3 won't have it — reload defaults those fields in that case.
   */
  inputs?: ScenarioInputs
  /** Schema/model version from the persisted forecastingProfiles row. */
  version?: number
  createdAt: string
  updatedAt: string
}

/**
 * A saved savings row coerced like the builder's `itemsFromSaved` (story 100.1,
 * AC-13): a non-string name becomes `''` and a non-finite or negative amount 0.
 * `unknown` because the row comes from parsed JSON a client wrote.
 */
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
 * A saved investment/debt row coerced like `savedSavingsAccount` (story 100.2,
 * AC-14): a non-string name becomes `''`, non-finite or negative money 0, an
 * unknown frequency `monthly`, and the flag is kept only `=== true` on an
 * investment. Returns `null` for a row that is neither an investment nor a debt:
 * its sign is unknowable, so it is DROPPED rather than guessed.
 *
 * `annualReturn` (story 100.3): kept on an investment row when it is a FINITE
 * number, even outside −100%..100% (D9: the builder flags it, refuse not clamp);
 * omitted otherwise (absent, `null`, a string), so the builder's default applies
 * (D3). Never kept on a debt row (D8). The builder coerces the same way on its own.
 *
 * Story 102.2 (version 5): the flag is kept `=== true` on a DEBT row too
 * ("Payment already in Expenses"); before, it was forced `false` there. The
 * v1-v4 legacy rule is NOT applied here but in the builder, which has `version`.
 * `paidByExpenseName` is kept on a debt row when it is a non-empty string.
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

/**
 * Map a server-side forecasting profile to the client SavedForecast shape.
 * scenarioData is a JSON string of { scenario, result }; returns null if it
 * cannot be parsed into the expected shape so a corrupt row can't crash the UI.
 */
function mapToSavedForecast(profile: ForecastWire): SavedForecast | null {
  try {
    const parsed = JSON.parse(profile.scenarioData) as {
      scenario?: ForecastingScenario
      result?: ForecastingResult
      inputs?: Omit<ScenarioInputs, 'savingsAccounts' | 'balanceAccounts'> & {
        savingsAccounts?: unknown
        balanceAccounts?: unknown
      }
    }
    // Validate the nested shape the saved-list UI actually dereferences
    // (result.summary.endingNetWorth / totalGrowth). A row that parses but is
    // missing scenario/result/summary is treated as corrupt and skipped so it
    // can't crash the list.
    if (!parsed?.scenario || !parsed?.result || !parsed.result.summary) {
      return null
    }
    // Only surface inputs when well-formed; a corrupt/partial blob (e.g. NaN, a
    // string, or years 0) falls back to defaults on reload — like a pre-bug-3 row
    // — instead of seeding a bad state or a divide-by-zero in the core calc.
    //
    // ⚠️ `years` is checked with core's `isValidForecastYears` — the SAME rule the
    // engine enforces (story 77.1, FR124). This used to be `isFinite && >= 1` with
    // NO upper bound: a saved `years` of 1e9 passed, seeded the builder, and its
    // mount-time recompute handed 1e9 to the engine on OPEN (measured with the
    // engine mocked; the loop would not have finished).
    //
    // ⚠️⚠️ Only `years` is replaced, NOT the whole `inputs` (77.1 code review, P1).
    // Rows saved before 77.1 could legitimately carry 31+ or a fraction — the
    // field's `max={30}` was an HTML hint — and dropping `inputs` for that reason
    // alone also dropped their savings/investments, so the reopened forecast
    // silently re-baselined to a starting net worth of 0 (the thing 62.1 AC-7
    // forbids). Non-finite money still discards `inputs`, as before.
    //
    // ⚠️ Savings rows (story 100.1, AC-13): a `savingsAccounts` that is not an
    // array is IGNORED (the forecast loads as v1, from `savings`), and a bad entry
    // is coerced, never a reason to drop `inputs` (the same P1 lesson as `years`).
    // When the rows' sum disagrees with `savings`, the ROWS win and `savings` is
    // recomputed from them (D7), so the builder and the engine agree on the start.
    const savedInputs = parsed.inputs
    const savingsAccounts = Array.isArray(savedInputs?.savingsAccounts)
      ? savedInputs.savingsAccounts.map(savedSavingsAccount)
      : undefined
    const savings = savingsAccounts
      ? savingsAccounts.reduce((sum, account) => sum + account.balance, 0)
      : savedInputs?.savings
    // Investment/debt rows (story 100.2, AC-14), the same rules: a non-array is
    // ignored (the forecast loads as v1/v2, from `investments`), entries are
    // coerced, an entry of an unknown type is DROPPED, and when the investment
    // rows' sum disagrees with `investments` the ROWS win.
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
      // The row arrives over JSON (`GET /api/forecasts`, story 83.1), so these are
      // ISO strings already. Re-serialising normalises the format and turns an
      // unparseable value into a throw, which the `catch` below maps to a skipped
      // row rather than an "Invalid Date" on screen.
      createdAt: new Date(profile.createdAt).toISOString(),
      updatedAt: new Date(profile.updatedAt).toISOString(),
    }
  } catch {
    return null
  }
}

// ============================================================================
// Main Component
// ============================================================================

/**
 * Forecasting Page Component
 *
 * Main page for premium forecasting features.
 * Handles access control and renders appropriate UI based on subscription status.
 */
function ForecastingPage(): React.ReactElement {
  const { status } = usePremiumAccess()
  const [activeTab, setActiveTab] = useState<ForecastingTab>('scenarios')
  // The latest forecast computed by the Scenario Builder, lifted here so the
  // Projections tab reflects the user's real scenario instead of sample data
  // (story bug-3).
  const [scenarioResult, setScenarioResult] = useState<ForecastingResult | null>(null)
  // The saved forecast the user chose to reopen ("My Forecasts" → Load). Drives
  // the ScenarioBuilder's `key` + `initialForecast` so it remounts seeded.
  const [loadedForecast, setLoadedForecast] = useState<SavedForecast | null>(null)
  // Bumped on every Load so the builder remounts even when the SAME forecast is
  // re-loaded (an id-only key would not change → stale edits would survive).
  const [loadNonce, setLoadNonce] = useState(0)
  /**
   * The saved forecast a Save under the SAME name writes over (story 97.1, FR157,
   * D2(c)): the one last loaded, or the one this builder last saved. A different
   * name saves a NEW forecast. `name` is the SERVER's (trimmed) name.
   *
   * ⚠️ Separate from `loadedForecast` on purpose: that one keys the builder's
   * remount, so setting it after a save would throw away the builder's state.
   */
  const [saveTarget, setSaveTarget] = useState<{ id: string; name: string } | null>(null)

  // Handle tab change. Retires the save confirmation: it names a specific
  // forecast, and leaving it up while the user works elsewhere lets it outlive
  // the thing it describes (code review 62.2).
  const handleTabChange = useCallback((tab: ForecastingTab) => {
    setSaveSuccess(null)
    setActiveTab(tab)
  }, [])

  // State for server-side forecasts
  const [serverForecasts, setServerForecasts] = useState<ForecastWire[]>([])
  /**
   * The user profile that newly-saved forecasts are attached to, as an EXPLICIT
   * four-arm status (story 62.2, FR95).
   *
   * ⚠️⚠️ This used to be a bare `string | null`, and that `null` meant FIVE
   * different things: the effect had not run yet, the account had zero profiles,
   * the session had expired, premium was denied at the server boundary
   * (`routes/api/profiles.ts`, `requirePremiumSession`), or the fetch threw. The UI could not
   * tell them apart, so the only feedback possible was a submit-time error that
   * guessed — and guessed "create a profile" for all five.
   *
   * Only `none` means "create a profile". Keying a prompt on `null` again would
   * flash that prompt on every page load during the fetch AND tell a user whose
   * network blipped to create a profile they already have.
   *
   * ⚠️ There is deliberately no separate loading flag beside this. A
   * `_isLoadingForecasts` state used to sit here, set on both edges and never
   * read; `kind: 'loading'` is now the single answer to "is the client's profile
   * data here yet", and a second flag would immediately start drifting from it.
   */
  const [profileState, setProfileState] = useState<ProfileAvailability>({ kind: 'loading' })
  const defaultProfileId = profileState.kind === 'ready' ? profileState.profileId : null
  /**
   * Confirmation of the last successful save, rendered by the PAGE.
   *
   * ⚠️ It cannot live in `ScenarioBuilder`: a successful save switches to the
   * "saved" tab, and the builder is CSS-hidden (never unmounted) whenever another
   * tab is active — so a confirmation rendered inside it would be invisible at
   * exactly the moment it is needed, while remaining perfectly findable in jsdom.
   * A unit test asserting it there would pass against a message no user can see.
   */
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null)
  /**
   * Whether a save is in flight, reported UP from the builder (code review 62.2).
   *
   * ⚠️ It exists to lock the tab strip. The failure alert renders inside the
   * builder, and switching tabs CSS-hides that panel — where `focus()` is a no-op
   * and a live region is never announced — so a user who tabbed away during a slow
   * save learned nothing at all. Only FAILURE was lost this way; success forces
   * its own tab switch.
   *
   * ⚠️⚠️ Because this DISABLES navigation, it must never latch. The builder drives
   * it from the same `finally` that clears its own `isSaving`, so every exit path —
   * resolve, reject, or a caller that throws — re-enables the tabs. Do not set it
   * from anywhere else; a second writer is how this becomes a trap.
   */
  const [isSavingForecast, setIsSavingForecast] = useState(false)

  // Load the user's default profile and saved forecasts from the server on mount
  // (`/api/profiles`, `/api/forecasts`: story 83.1)
  useEffect(() => {
    const loadData = async () => {
      try {
        // Resolve the user's default profile (or first profile) so saves have a
        // valid profileId to attach to. Same-origin `fetch` to `/api/profiles`
        // (story 83.1); the session cookie travels on its own.
        const profilesResult = await fetchProfiles()
        let resolvedProfileId: string | null = null
        if (!profilesResult.success) {
          // ⚠️ NOT "no profile". `/api/profiles` fails for an expired session
          // (401), a premium denial at the server boundary (403) and an outage
          // (503), and this account may well have profiles it simply could not read.
          setProfileState({ kind: 'error' })
        } else if (!Array.isArray(profilesResult.data)) {
          // ⚠️ A malformed success is an ERROR, not an empty account (code review
          // 62.2). This used to be folded into the `none` branch below, which told
          // a user with a well-stocked account that they had no profile — wrong
          // advice about their own data, produced by a response shape the server
          // does not actually emit today.
          setProfileState({ kind: 'error' })
        } else if (profilesResult.data.length === 0) {
          // The ONLY branch that means the account genuinely has no profile: a
          // well-formed success carrying an empty array. Soft-deleted tombstones
          // are already excluded server-side (`getProfiles` in
          // `server/functions/profiles.ts`), so an empty list really is empty.
          setProfileState({ kind: 'none' })
        } else {
          const defaultProfile =
            profilesResult.data.find((p) => p.isDefault) ?? profilesResult.data[0]
          // ⚠️ Guard on the ID, not merely on the element (code review 62.2). The
          // `find(...) ?? [0]` fallback with `length > 0` is ALWAYS truthy, so the
          // old `if (defaultProfile)` was dead code and an empty `id` reached
          // `{kind:'ready'}` — where `defaultProfileId` derives falsy and the save
          // guard emits "No financial profile found", i.e. the one-message-for-
          // everything defect this story removed, on the arm that claims success.
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
        // ⚠️ A throw is an ERROR arm, never the "no profile" arm. It is a network
        // failure (`fetch` rejects; a non-JSON body is already a `success: false`
        // result, see `forecast-api.ts`). Until story 83.1 it was also the
        // `ReferenceError: Buffer is not defined` of the client-side server import
        // this page used to make (story 80.1 Fact R). Treating either as "you have
        // no profiles" would put wrong advice on screen.
        // The log stays: it is the only record of WHICH error occurred, and it is
        // explicitly not the user-facing feedback (that is the notice below).
        console.error('Failed to load forecasting data:', error)
        // ⚠️⚠️ ONLY demote a state that is still UNRESOLVED (code review 62.2).
        // This `try` wraps BOTH fetches. `fetchForecasts` runs AFTER the
        // profile arm has been set, so an unconditional `{kind:'error'}` here let
        // a failure of the SAVED-FORECAST LIST flip a perfectly good `ready` to
        // `error` — disabling Save and stating "We could not check your financial
        // profiles" about a check that had just succeeded. That was a REGRESSION
        // against `581c3f8`, where the save still worked in exactly that case.
        setProfileState((current) => (current.kind === 'loading' ? { kind: 'error' } : current))
      }
    }

    if (status.hasAccess && status.isAuthenticated) {
      loadData()
    }
  }, [status.hasAccess, status.isAuthenticated])

  // Handle saving a forecast: `PUT /api/forecasts?id=` over the save target when
  // the name is unchanged (story 97.1), else `POST /api/forecasts` (a new one)
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
      // ⚠️ LAST LINE OF DEFENCE, NOT THE FEATURE. The builder already disables
      // Save and explains itself for `none` and `error` (story 62.2, AC-1), so a
      // user should never reach this. It still reports the RIGHT reason rather
      // than one message for all four arms — the defect this story fixed.
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
        // Convert forecast to input format
        const input = {
          name: forecast.name,
          description: forecast.description,
          // Persist the builder inputs alongside scenario+result so the forecast
          // reopens faithfully (story bug-3). scenarioData is a JSON blob, so this
          // adds no schema/migration.
          scenarioData: {
            scenario: forecast.scenario,
            result: forecast.result,
            inputs: forecast.inputs,
          },
          profileId: defaultProfileId,
        }

        // The same name as the forecast last loaded or saved: save OVER it (`PUT`,
        // story 97.1, D2(c)). Compared TRIMMED against the SERVER's name, which is
        // stored trimmed: "Plan " after loading "Plan" is still that forecast.
        // Any other name is a new forecast (`POST`, story 83.1), so a different
        // forecast is never overwritten. A refusal's `error` is the server's
        // message (duplicate name, deleted profile, …) and is shown verbatim.
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
          // Reload forecasts (scoped to the same profile) to get the updated list
          const getResult = await fetchForecasts(defaultProfileId)

          if (getResult.success && getResult.data) {
            setServerForecasts(getResult.data)
          }
          // The tab switch is a real signal but it is NOT sufficient on its own —
          // it is silent for assistive tech and easy to miss on a long page. The
          // confirmation below names what was saved and is announced politely.
          setSaveSuccess(forecast.name)
          setActiveTab('saved')
          return { success: true }
        }

        // A failed save (e.g. duplicate name hitting the unique constraint) must
        // be surfaced to the user, not silently swallowed.
        // ⚠️ Both logs below are KEPT DELIBERATELY (story 62.2, AC-6) and neither
        // is the user-facing feedback: the RETURNED `error` is, and the builder
        // renders it beside the Save button. A console log is invisible to the
        // user and invisible to the gate — `forecasting-intro.test.tsx:41-49`
        // records, measured, that this suite does not fail on console errors. Do
        // not cite either of these as "the user is informed".
        // The forecast was deleted elsewhere (story 97.1, D3): it is no longer the
        // target, so the next Save creates it. The server's message says so.
        // The list is refetched too (code review of 97.1): otherwise My Forecasts
        // keeps showing the gone forecast, and Loading it re-targets a dead id.
        // A failed refetch must not replace the 404's message, hence the catch.
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

  // Handle deleting a forecast - `DELETE /api/forecasts`
  const handleDeleteForecast = useCallback(
    async (id: string) => {
      // The confirmation names a forecast by name; deleting one must not leave a
      // banner claiming it was just saved (code review 62.2).
      setSaveSuccess(null)
      try {
        const result = await deleteForecast(id)

        if (result.success) {
          // A deleted forecast is no longer the save target, so the next Save
          // creates a new one (story 97.1, D3). Bulk delete calls this per id.
          setSaveTarget((target) => (target?.id === id ? null : target))
          // Reload forecasts (scoped to the same profile) to get the updated list
          const getResult = await fetchForecasts(defaultProfileId ?? undefined)

          if (getResult.success && getResult.data) {
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

  // Reopen a saved forecast into the Scenario Builder (story bug-3). Seeds the
  // builder (via key + initialForecast), shows its projection immediately, and
  // switches to the builder tab so the user lands on the reloaded scenario.
  const handleLoadForecast = useCallback((forecast: SavedForecast) => {
    // Reopening a different scenario retires the previous save confirmation.
    setSaveSuccess(null)
    setLoadedForecast(forecast)
    // `forecast.name` is the server's row name (`mapToSavedForecast`).
    setSaveTarget({ id: forecast.id, name: forecast.name })
    setLoadNonce((n) => n + 1)
    setScenarioResult(forecast.result)
    setActiveTab('scenarios')
  }, [])

  // Show loading state (SSR + first client paint — see usePremiumAccess).
  if (status.isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <LoadingSpinner />
      </div>
    )
  }

  // Show premium prompt if user doesn't have access
  if (!status.hasAccess) {
    return (
      <div className="min-h-screen surface-sunken flex items-center justify-center p-4">
        {/* The free user's pitch for this page. Named situations, not "advanced
            tools" — same set as the intro, the meta description above, and the
            `PREMIUM_FEATURES.forecasting` bullet the prompt lists directly below
            this message. All four are constrained by the same rule: only what the
            engine READS (and the tests spot-check that rule, they do not enforce
            it — see the meta comment above).
            ⚠️ `featureName` feeds `forecasting-intro.test.tsx`'s free-user
            positive control (`/advanced forecasting/i`). It is NOT the only
            source of that match: MEASURED on the real free branch, the regex
            matches TWO elements — this `featureName` span and the benefit `<li>`
            rendered from `PREMIUM_FEATURES.forecasting` (`premium-prompt.tsx`),
            because RTL matches an element on its own direct text nodes. So
            dropping `featureName` would NOT make that control vacuous; the `<li>`
            still matches. Reword either one and the control still holds, but
            reword BOTH and the free-user absence test loses its control and
            starts passing for the wrong reason. */}
        <PremiumPrompt
          featureName="Advanced Forecasting"
          message="See how a raise, rising bills, a big one-off cost, paying down a loan or saving more each month would change your finances over the years ahead — and save each scenario to reopen later."
          asDialog={false}
        />
      </div>
    )
  }

  // Main premium content
  return (
    <div className="min-h-screen surface-sunken">
      {/* Header */}
      <PageHeader />

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Intro (story 57.1, FR86) — names the SITUATIONS this page models so a
            paid user who arrived from the nav (epic 58), with no Overview card
            copy in view, can tell straight away whether this is the tool they
            want. ⚠️ Every situation named must be expressible by what
            `calculateFinancialForecast` actually READS: the two growth rates and
            `oneTimeEvents`, which is the only DATED input. Its `amount` is SIGNED
            and simply summed into that year's net income, so since story
            `forecast-1` — which added the Money in / Money out control — an
            event can be an OUTFLOW as well as an inflow.
            `newIncome`/`newExpenses` are not read BY THE CALCULATION — they are
            the save format for the builder's rows, so do not cite them as
            scenario-expressive and do not delete them either.
            So a one-off cost IS claimable; a house purchase and an early
            retirement are still out, because each needs a RECURRING change dated
            to a chosen year and recurring items carry no start/end year. (A house
            DEPOSIT is fine — it is a single dated outflow; the mortgage is not.)
            Since story 100.2 the balance rows also make "paying down a loan" (a
            debt row's payment) and "saving more each month" (an investment
            contribution) claimable. Since story 102.2 a debt row's payment is
            cash out while the debt is owed and stops at payoff, unless the row is
            flagged "Payment already in Expenses".
            Keep this in step with `PremiumFeatureLabel`'s docblock in HomePage.tsx.
            No positional wording ("below"): the intro renders on every tab, and
            the builder is only on the first one. */}
        <p data-testid="forecasting-intro" className="text-body mb-6 max-w-3xl">
          Wondering how a raise, steadily rising bills, a big one-off cost, paying down a loan or
          saving more each month would change things? Build it out here and see how your finances
          track over the years ahead.
        </p>

        {/* Tabs */}
        <div className="mb-8">
          <TabNavigation
            activeTab={activeTab}
            onTabChange={handleTabChange}
            disabled={isSavingForecast}
          />
        </div>

        {/* Save confirmation (story 62.2, AC-5).
            ⚠️ It lives HERE, outside the tab panel, and not in ScenarioBuilder —
            a successful save switches to the "saved" tab, which CSS-hides the
            builder, so a confirmation inside it would be invisible at the one
            moment it matters. It is `polite`, not an alert, and does not take
            focus: the tab switch has already moved the user's context, and the
            failure arm (inside the builder, beside the button) is the one where
            the user has something to act on. */}
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

        {/* Tab Content */}
        <div className="surface rounded-xl shadow-lg p-4 sm:p-8">
          {/* The builder stays mounted (hidden when another tab is active) so
              switching to Projections/Saved and back does NOT wipe unsaved edits.
              Only a Load (via the nonce below) or a fresh session resets it. */}
          <div className={activeTab === 'scenarios' ? '' : 'hidden'}>
            <ScenarioBuilder
              // Remount (resetting all internal state) on every Load — including
              // re-loading the same forecast — so the builder re-seeds from it.
              key={`${loadedForecast?.id ?? 'new'}-${loadNonce}`}
              initialForecast={loadedForecast}
              onSave={handleSaveForecast}
              onResultChange={setScenarioResult}
              // The page owns the profile lookup; the builder only renders the
              // answer. Passing the `kind` alone keeps the profile id off a
              // component that has no business with it.
              saveAvailability={{ kind: profileState.kind }}
              onSavingChange={setIsSavingForecast}
            />
          </div>

          {activeTab === 'projections' && <ProjectionChart result={scenarioResult} />}

          {activeTab === 'saved' && (
            <ForecastList
              forecasts={serverForecasts
                .map(mapToSavedForecast)
                .filter((f): f is SavedForecast => f !== null)}
              onDelete={handleDeleteForecast}
              onLoad={handleLoadForecast}
            />
          )}
        </div>

        {/* Info Footer */}
        <PageFooter />
      </main>
    </div>
  )
}

// ============================================================================
// Subcomponents
// ============================================================================

/**
 * Page Header Component
 */
function PageHeader(): React.ReactElement {
  return (
    <header className="surface border-b border-default sticky top-0 z-10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
        <div className="flex items-center justify-between">
          {/* ⚠️ NO SUBTITLE HERE — DELIBERATE, and the deletion is the point.
              This header used to carry "Advanced tools for modeling your
              financial future", which sat directly above story 57.1's
              `forecasting-intro` paragraph, so the page opened with two stacked
              taglines saying the same thing at different levels of vagueness.
              57.1 flagged it and left the call to Lucas; DECIDED 2026-09-21 —
              delete the subtitle, keep the intro. The `<h1>` identifies the
              page; the intro does the explaining, and it is the one that names
              situations the engine can actually model.
              This header is `sticky`, so every line here costs vertical space on
              a phone for the whole scroll.
              ⚠️ Do NOT "restore the missing subtitle" — its absence is pinned by
              `__tests__/forecasting-intro.test.tsx`.
              ⚠️ NO "Premium Feature" BADGE EITHER (story 108.1, FR176, D5,
              Lucas 2026-10-06: removed at every width). Only a premium user
              reaches this header, so the badge told them nothing. Pinned by
              `__tests__/forecasting-header.test.tsx`. */}
          <div>
            <h1 className="text-2xl font-bold text-subheading">Financial Forecasting</h1>
          </div>
        </div>
      </div>
    </header>
  )
}

/**
 * Tab Navigation Component
 */
interface TabNavigationProps {
  activeTab: ForecastingTab
  onTabChange: (tab: ForecastingTab) => void
  /**
   * Locks the tab strip while a save is in flight (code review 62.2). Switching
   * tabs CSS-hides the builder, and the failure alert lives inside it — hidden,
   * it is neither focusable nor announced, so a user who tabbed away during a
   * slow save was never told the save had failed.
   */
  disabled?: boolean
}

// Story 95.1 (FR154, D3): the per-tab descriptions that sat beside the strip at
// ≥ 640 px ("Create and model financial scenarios" …) were filler and are gone.
const tabs: { id: ForecastingTab; label: string }[] = [
  { id: 'scenarios', label: 'Scenario Builder' },
  { id: 'projections', label: 'Projections' },
  { id: 'saved', label: 'My Forecasts' },
]

/**
 * Below `sm` (story 91.3, FR147). At 320 px the three tabs measured 388 px in a
 * 288 px content box (DejaVu, `91-3-evidence/`): each button's min-content is its
 * longest word + `px-4` + a 16 px icon + `ml-2`, so the page scrolled sideways by
 * 80 px (still 25 px at 375). On a phone the icons go (they are `aria-hidden`, so
 * no tab is renamed), the padding drops to `px-1.5`, and the buttons share the
 * strip, where a label wraps between its words ("Scenario / Builder"), centred.
 * `min-w-0` lets a larger system font or text zoom squeeze the buttons rather than
 * push the page sideways.
 *
 * Story 93.1 (D3 option B, MEASURED under DejaVu at 320 px, `93-1-evidence/`):
 * with `px-2` a single word wider than its button overflowed it on both sides
 * under text-only zoom: "Projections" by 4.5 px each side at 125 %, and at 150 %
 * it crossed both neighbours by 10.1 px. So the label may now break INSIDE a
 * word ({@link TAB_LABEL_CLASS}). That alone split "Projection|s" at 100 % (the
 * word is 76.5 px, the `px-2` content box 74.7 px), hence `px-1.5`: a 78.7 px
 * box, and 100 % renders exactly as before. Mid-word breaks start at 125 %.
 * Every token is `max-sm:`, so ≥ 640 px renders exactly as before.
 */
const TAB_BUTTON_PHONE_CLASS = 'max-sm:flex-1 max-sm:min-w-0 max-sm:px-1.5'
const TAB_CONTENT_CLASS = 'flex items-center max-sm:justify-center max-sm:text-center'
const TAB_ICON_PHONE_CLASS = 'max-sm:hidden'
/** `anywhere` (phone only, story 93.1): a word wider than its button breaks rather
 * than overflowing into the neighbouring tab. See {@link TAB_BUTTON_PHONE_CLASS}. */
const TAB_LABEL_CLASS = 'ml-2 max-sm:ml-0 max-sm:[overflow-wrap:anywhere]'

function TabNavigation({
  activeTab,
  onTabChange,
  disabled = false,
}: TabNavigationProps): React.ReactElement {
  return (
    <div className="flex flex-col sm:flex-row gap-4">
      <div className="flex space-x-1 bg-gray-100 dark:bg-gray-700 rounded-lg p-1">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => onTabChange(tab.id)}
            disabled={disabled}
            className={`px-4 ${TAB_BUTTON_PHONE_CLASS} py-2 text-sm font-medium rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed ${
              activeTab === tab.id
                ? 'bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 shadow-sm'
                : 'text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600 hover:text-gray-700 dark:hover:text-gray-100'
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

/**
 * Get tab icon based on tab ID and active state
 */
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

/**
 * Page Footer Component
 */
function PageFooter(): React.ReactElement {
  return (
    <footer className="mt-8 pt-6 border-t border-default text-center">
      <p className="text-xs text-faint">
        Forecasts calculated in your browser • Saved forecasts stored in Germany (EU)
      </p>
    </footer>
  )
}

/**
 * Loading Spinner Component
 */
function LoadingSpinner(): React.ReactElement {
  return (
    <div className="flex items-center justify-center space-x-2">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      <span className="text-body">Loading...</span>
    </div>
  )
}

// ============================================================================
// Icon Components
// ============================================================================

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
