import spreadsheetBody from './longhand-vs-spreadsheet.md?raw'

// A const tuple, so a page that omits a row is a type error rather than a missing table line.
export const COMPARE_ROW_IDS = [
	'priceMonthly',
	'priceAnnual',
	'priceLifetime',
	'freeTier',
	'bankSync',
	'tracksTransactions',
	'manualEntry',
	'accountRequired',
	'platforms',
	'offline',
	'dataLocation',
	'thirdParties',
	'forecasting',
	'separateBudgets',
	'sharing',
	'reportsExport',
	'adsTrackersAi',
] as const

export type CompareRowId = (typeof COMPARE_ROW_IDS)[number]

export const COMPARE_ROW_LABELS = {
	priceMonthly: 'Monthly price',
	priceAnnual: 'Yearly price',
	priceLifetime: 'One-time (lifetime) price',
	freeTier: 'Free tier',
	bankSync: 'Bank sync',
	tracksTransactions: 'Tracks individual transactions',
	manualEntry: 'Manual entry',
	accountRequired: 'Account required',
	platforms: 'Platforms',
	offline: 'Works offline',
	dataLocation: 'Where your data lives',
	thirdParties: 'Third parties that see your data',
	forecasting: 'Forecasting and what-if scenarios',
	separateBudgets: 'Separate budgets (e.g. personal and household)',
	sharing: 'Sharing with another person',
	reportsExport: 'Reports and export',
	adsTrackersAi: 'Ads, trackers, AI',
} as const satisfies Record<CompareRowId, string>

type CompareCell = {
	readonly longhand: string
	readonly competitor: string
	readonly source?: string
}

type CompareFaq = {
	readonly q: string
	readonly a: string
}

type CompareSource = {
	readonly label: string
	readonly url: string
}

export type ComparePage = {
	readonly slug: string
	readonly competitorName: string
	readonly title: string
	readonly description: string
	readonly verifiedOn: string
	readonly competitorPricingUrl: string
	readonly verdict: string
	readonly body: string
	readonly rows: Readonly<Record<CompareRowId, CompareCell>>
	readonly competitorBetter: readonly string[]
	readonly longhandBetter: readonly string[]
	readonly switching: string
	readonly faq: readonly CompareFaq[]
	readonly sources: readonly CompareSource[]
}

const DEBT_COM_SURVEY = 'https://www.debt.com/research/best-way-to-budget/'
const MICROSOFT_365_PRICING =
	'https://www.microsoft.com/en-us/microsoft-365/buy/compare-all-microsoft-365-products'
const EXCEL_WEB_FREE =
	'https://www.microsoft.com/en-us/microsoft-365/free-office-online-for-the-web'
const TILLER_PRICING = 'https://tiller.com/pricing/'
const TILLER_FORMULAS = 'https://community.tiller.com/t/broken-formulas/24085'
const TILLER_VS_APPS = 'https://tiller.com/spreadsheet-budgeting-vs-budgeting-apps/'
const GOOGLE_DATA_REGIONS =
	'https://knowledge.workspace.google.com/admin/compliance/choose-a-geographic-location-for-your-data'
const MICROSOFT_PRIVACY = 'https://www.microsoft.com/en-us/privacy/privacystatement'

const spreadsheet: ComparePage = {
	slug: 'longhand-vs-spreadsheet',
	competitorName: 'A spreadsheet (Excel or Google Sheets)',
	title: 'Longhand Budget vs a spreadsheet',
	description:
		'A budget spreadsheet is free and endlessly flexible. Longhand Budget gives up the flexibility for guardrails, built-in forecasting and a plan that keeps working. An honest, dated comparison.',
	verifiedOn: '2026-10-11',
	competitorPricingUrl: MICROSOFT_365_PRICING,
	verdict:
		'If you want to record and track every purchase, a spreadsheet does that and Longhand Budget does not. If you want to plan from the figures you already know, such as income, bills, savings and debts, and see where they lead, Longhand Budget is built for exactly that and will not break when you edit a cell.',
	body: spreadsheetBody,
	rows: {
		priceMonthly: {
			longhand: '€5.99, or nothing on the free tier',
			competitor: 'Google Sheets: free. Microsoft 365 Personal: $9.99 (Excel desktop).',
			source: MICROSOFT_365_PRICING,
		},
		priceAnnual: {
			longhand: '€39, or nothing on the free tier',
			competitor: 'Google Sheets: free. Microsoft 365 Personal: $99.99 a year (99 € in Germany).',
			source: MICROSOFT_365_PRICING,
		},
		priceLifetime: {
			longhand: '€99 once',
			competitor: 'Google Sheets and Excel for the web: free for as long as the account exists.',
			source: EXCEL_WEB_FREE,
		},
		freeTier: {
			longhand: 'The whole planner, no account, data stays in your browser',
			competitor: 'The whole spreadsheet; templates free or about $1 to $2.50 on Etsy',
		},
		bankSync: {
			longhand: 'Never. Longhand Budget does not connect to any bank.',
			competitor:
				'Not built in. Tiller adds US bank feeds to a sheet for $99 a year; US banks only.',
			source: TILLER_PRICING,
		},
		tracksTransactions: {
			longhand: 'No. Longhand Budget plans from recurring figures; it does not record purchases.',
			competitor: 'Yes, if you build and maintain a transactions tab.',
		},
		manualEntry: {
			longhand: 'Yes, structured: income, expenses, savings, balances, each with a frequency',
			competitor: 'Yes, free-form: any cell, any layout',
		},
		accountRequired: {
			longhand: 'No for the free tier. An email address for premium sync.',
			competitor: 'A Google or Microsoft account for the cloud versions; none for a desktop file.',
		},
		platforms: {
			longhand: 'Web app that installs as a PWA on phone and desktop; no native app store apps',
			competitor: 'Everywhere: desktop, web, native mobile apps',
		},
		offline: {
			longhand: 'Yes, the installed app keeps working offline',
			competitor: 'Desktop Excel and LibreOffice: yes. Google Sheets: with offline mode enabled.',
		},
		dataLocation: {
			longhand:
				'Free tier: on your device only. Premium sync: servers in Germany, run by an EU host.',
			competitor:
				'Google Drive and OneDrive consumer accounts give no choice of region. A desktop file stays on your computer.',
			source: GOOGLE_DATA_REGIONS,
		},
		thirdParties: {
			longhand: 'None for your figures; the payment processor sees billing details only',
			competitor:
				'Google or Microsoft hold the cloud file and may process it in the United States or elsewhere.',
			source: MICROSOFT_PRIVACY,
		},
		forecasting: {
			longhand:
				'Premium: saved what-if scenarios, year-by-year projections. Free: a retirement projection.',
			competitor: 'Only what you build with formulas',
		},
		separateBudgets: {
			longhand: 'Premium profiles, switchable without mixing numbers',
			competitor: 'As many files or tabs as you like',
		},
		sharing: {
			longhand: 'No. One person per account.',
			competitor: 'Yes. Google Sheets shares and co-edits natively.',
		},
		reportsExport: {
			longhand: 'Premium: a PDF summary report. No CSV import or export.',
			competitor: 'The file is the export: CSV, PDF, XLSX, anything',
		},
		adsTrackersAi: {
			longhand: 'No ads, no trackers, no AI features',
			competitor:
				'No ads in the file. Google and Microsoft run their own analytics and AI features in the apps.',
		},
	},
	competitorBetter: [
		'It is free, with no new vendor to trust and no subscription to cancel.',
		'You own the file forever and can open it in Excel, Google Sheets or LibreOffice.',
		'Unlimited flexibility: irregular income, custom categories, any chart you can write a formula for.',
		'A desktop spreadsheet is fully offline and account-free, exactly as private as Longhand Budget’s free tier.',
		'Google Sheets shares and co-edits with a partner natively; Longhand Budget has no sharing between people.',
		'It tracks individual transactions if you build a tab for them; Longhand Budget does not track spending at all.',
	],
	longhandBetter: [
		'Nothing breaks. The documented way spreadsheet budgets die is a typed-over formula, a #REF error or a new file every January.',
		'Weekly, biweekly, monthly and yearly amounts are converted to one monthly basis for you, so totals are comparable without a formula.',
		'Net worth, debts and savings goals are modelled, not improvised: a debt links to the payment that pays it down.',
		'Premium forecasting saves named what-if scenarios you can reload, instead of a copy of the sheet with different numbers.',
		'Usable on a phone: a spreadsheet on a phone screen is awkward, and even spreadsheet vendors say so.',
		'Privacy without a desktop file: the free tier never leaves your browser, and premium sync stores your plan in Germany with an EU host rather than a US-controlled consumer cloud.',
	],
	switching:
		'There is no import. Longhand Budget plans from recurring figures, so you open your sheet beside it and enter each income, bill, savings goal and balance once, with its frequency. For a typical household that is a few dozen entries. Your spreadsheet keeps working; nothing is deleted or converted.',
	faq: [
		{
			q: 'Can I import my spreadsheet into Longhand Budget?',
			a: 'No. Longhand Budget has no import and no CSV export. You re-enter your recurring figures once; day-to-day purchases are not something Longhand Budget records.',
		},
		{
			q: 'Is a spreadsheet more private than Longhand Budget?',
			a: 'A spreadsheet saved as a file on your own computer is exactly as private as Longhand Budget’s free tier: nothing leaves the device. A spreadsheet in Google Drive or OneDrive is different: consumer accounts offer no choice of region, and the vendor may process the file in the United States. Longhand Budget’s premium sync stores your plan in Germany with an EU host.',
		},
		{
			q: 'Does Longhand Budget replace my spreadsheet for tracking spending?',
			a: 'No. Longhand Budget does not track spending or import transactions. It is a planner for the figures you already know. If you record every purchase in your sheet, keep that tab.',
		},
		{
			q: 'What does the free tier cost, and what is in it?',
			a: 'Nothing, with no account. Income and expenses with frequencies, savings goals, balances and net worth, charts, a retirement projection, dark mode and currency formatting, all stored in your browser.',
		},
		{
			q: 'What about Tiller, the spreadsheet with bank feeds?',
			a: 'Tiller costs $99 a year and exists to pull US bank transactions into Google Sheets or Excel. Its bank feeds cover US banks only, and it needs bank linking to be worth the fee. Longhand Budget never links a bank, so the two solve different problems.',
		},
	],
	sources: [
		{ label: 'Debt.com 2026 budgeting survey', url: DEBT_COM_SURVEY },
		{ label: 'Microsoft 365 plans and prices', url: MICROSOFT_365_PRICING },
		{ label: 'Excel for the web is free', url: EXCEL_WEB_FREE },
		{ label: 'Tiller pricing', url: TILLER_PRICING },
		{ label: 'Tiller community: broken formulas', url: TILLER_FORMULAS },
		{ label: 'Tiller: spreadsheet budgeting vs budgeting apps', url: TILLER_VS_APPS },
		{ label: 'Google Workspace data regions', url: GOOGLE_DATA_REGIONS },
		{ label: 'Microsoft privacy statement', url: MICROSOFT_PRIVACY },
	],
}

export const COMPARE_PAGES: readonly ComparePage[] = [spreadsheet]

export function getComparePage(slug: string): ComparePage | undefined {
	return COMPARE_PAGES.find((page) => page.slug === slug)
}
