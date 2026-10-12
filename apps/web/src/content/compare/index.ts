import actualBudgetBody from './longhand-vs-actual-budget.md?raw'
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
	readonly competitorPricingLabel: string
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
const GOOGLE_PRIVACY = 'https://policies.google.com/privacy'
const MICROSOFT_365_PRICING_DE =
	'https://www.hagel-it.de/microsoft-365-insights/was-kostet-microsoft-365-fuer-privatpersonen'
const ETSY_BUDGET_SHEET_LISTING =
	'https://findniche.com/etsy-product/budget-planner-google-sheet-monthly-budg-1619225413'

export const TRADEMARK_LINE =
	'Product names are trademarks of their respective owners. Longhand Budget is not affiliated with or endorsed by any of them.'

const ACTUAL_PIKAPODS_DOC = 'https://actualbudget.org/docs/install/pikapods/'
const PIKAPODS_CATALOGUE = 'https://www.pikapods.com/apps'
const ACTUAL_BANK_SYNC_DOC = 'https://actualbudget.org/docs/advanced/bank-sync/'
const SIMPLEFIN_BRIDGE = 'https://beta-bridge.simplefin.org/'
const ACTUAL_INSTALL_DOC = 'https://actualbudget.org/docs/install/'
const ACTUAL_DESKTOP_DOC = 'https://actualbudget.org/docs/install/desktop-app/'
const ACTUAL_FAQ = 'https://actualbudget.org/docs/faq/'
const ACTUAL_SYNC_DOC = 'https://actualbudget.org/docs/getting-started/sync/'
const ACTUAL_REPORTS_DOC = 'https://actualbudget.org/docs/reports/'
const ACTUAL_FORECAST_DOC = 'https://actualbudget.org/docs/experimental/balance-forecast-report/'
const ACTUAL_SCHEDULES_DOC = 'https://actualbudget.org/docs/schedules/'
const ACTUAL_BACKUP_DOC = 'https://actualbudget.org/docs/backup-restore/backup/'
const ACTUAL_OAUTH_DOC = 'https://actualbudget.org/docs/config/oauth-auth/'
const ACTUAL_RELEASES = 'https://actualbudget.org/docs/releases/'
const ACTUAL_GITHUB = 'https://github.com/actualbudget/actual'
const FINCOMPARELAB_ACTUAL_COST = 'https://www.fincomparelab.com/?p=1279'
const FINNY_ACTUAL_REVIEW = 'https://getfinny.app/blog/actual-budget-review-2026'

const spreadsheet: ComparePage = {
	slug: 'longhand-vs-spreadsheet',
	competitorName: 'a spreadsheet (Excel or Google Sheets)',
	title: 'Longhand Budget vs a spreadsheet',
	description:
		'A budget spreadsheet is free and endlessly flexible. Longhand Budget gives up the flexibility for guardrails, built-in forecasting and a plan that keeps working. An honest, dated comparison.',
	verifiedOn: '2026-10-11',
	competitorPricingUrl: MICROSOFT_365_PRICING,
	competitorPricingLabel: 'Microsoft 365 pricing',
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
			competitor: 'Google Sheets: free. Microsoft 365 Personal: $99.99 a year, 99 € in Germany.',
			source: MICROSOFT_365_PRICING_DE,
		},
		priceLifetime: {
			longhand: '€99 once',
			competitor:
				'Google Sheets: free. Excel for the web: free with a Microsoft account, files saved to OneDrive.',
			source: EXCEL_WEB_FREE,
		},
		freeTier: {
			longhand: 'The whole planner, no account, data stays in your browser',
			competitor:
				'The whole spreadsheet; templates free, or $0.99 to $2.50 for bestsellers on Etsy',
			source: ETSY_BUDGET_SHEET_LISTING,
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
			competitor: 'Desktop, web and mobile apps from Microsoft and Google',
			source: MICROSOFT_365_PRICING,
		},
		offline: {
			longhand: 'Yes, the installed app keeps working offline',
			competitor: 'Desktop Excel and LibreOffice: yes, the file is on your computer.',
		},
		dataLocation: {
			longhand:
				'Free tier: on your device only. Premium sync: servers in Germany, run by an EU host.',
			competitor:
				'Google Drive and OneDrive consumer accounts give no choice of region. A desktop file stays on your computer.',
			source: GOOGLE_DATA_REGIONS,
		},
		thirdParties: {
			longhand:
				'Free: none. Premium: the EU hosting provider stores your synced plan; Paddle sees billing, Brevo your sign-in email.',
			competitor:
				'Google or Microsoft hold the cloud file and may process it in the United States or elsewhere.',
			source: GOOGLE_PRIVACY,
		},
		forecasting: {
			longhand: 'Premium: saved what-if scenarios with projections. Free: a retirement projection.',
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
				'No ads in the file itself. A cloud spreadsheet sits under Google\u2019s or Microsoft\u2019s general privacy terms, which let your data be used to improve or develop their services; Microsoft\u2019s statement says that may include training AI models.',
			source: MICROSOFT_PRIVACY,
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
		'Privacy without a desktop file. The free tier never leaves your browser. Premium sync stores your plan in Germany with an EU host rather than a US-controlled consumer cloud.',
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
			a: 'Tiller costs $99 a year and exists to pull US bank transactions into Google Sheets or Excel. Its bank feeds cover US banks only. Longhand Budget never links a bank, so the two solve different problems.',
		},
	],
	sources: [
		{ label: 'Debt.com 2026 budgeting survey', url: DEBT_COM_SURVEY },
		{ label: 'Microsoft 365 plans and prices', url: MICROSOFT_365_PRICING },
		{ label: 'Microsoft 365 prices in Germany', url: MICROSOFT_365_PRICING_DE },
		{ label: 'Etsy budget-sheet bestseller listing', url: ETSY_BUDGET_SHEET_LISTING },
		{ label: 'Excel for the web is free', url: EXCEL_WEB_FREE },
		{ label: 'Tiller pricing', url: TILLER_PRICING },
		{ label: 'Tiller community: broken formulas', url: TILLER_FORMULAS },
		{ label: 'Tiller: spreadsheet budgeting vs budgeting apps', url: TILLER_VS_APPS },
		{ label: 'Google Workspace data regions', url: GOOGLE_DATA_REGIONS },
		{ label: 'Microsoft privacy statement', url: MICROSOFT_PRIVACY },
		{ label: 'Google privacy policy', url: GOOGLE_PRIVACY },
	],
}

const actualBudget: ComparePage = {
	slug: 'longhand-vs-actual-budget',
	competitorName: 'Actual Budget',
	title: 'Longhand Budget vs Actual Budget',
	description:
		'Actual Budget is free, open source and tracks every transaction, but you host it yourself. Longhand Budget plans from the figures you know, with nothing to run. An honest, dated comparison.',
	verifiedOn: '2026-10-11',
	competitorPricingUrl: ACTUAL_PIKAPODS_DOC,
	competitorPricingLabel: 'Actual Budget hosting costs',
	verdict:
		'If you want to import and track every transaction in envelopes, and you are happy to run a server or rent one, Actual Budget does that for free and Longhand Budget does not track spending at all. If you want to plan from the figures you already know, such as income, bills, savings and debts, with nothing to host and your premium sync kept in Germany, Longhand Budget is built for exactly that.',
	body: actualBudgetBody,
	rows: {
		priceMonthly: {
			longhand: '€5.99, or nothing on the free tier',
			competitor:
				'The app is free. Hosted sync from about $2 a month on PikaPods; bank feeds via SimpleFIN $1.50 a month.',
			source: PIKAPODS_CATALOGUE,
		},
		priceAnnual: {
			longhand: '€39, or nothing on the free tier',
			competitor:
				'The app is free. A 2026 cost breakdown puts hosting plus bank feeds at about $33 a year.',
			source: FINCOMPARELAB_ACTUAL_COST,
		},
		priceLifetime: {
			longhand: '€99 once',
			competitor: 'Free forever (MIT licence); hosting stays a running cost if you want sync.',
			source: ACTUAL_GITHUB,
		},
		freeTier: {
			longhand: 'The whole planner, no account, data stays in your browser',
			competitor: 'Everything: the whole app, unlimited devices and budget files',
		},
		bankSync: {
			longhand: 'Never. Longhand Budget does not connect to any bank.',
			competitor:
				'Optional, and it needs your own server: SimpleFIN for North America ($15 a year), Enable Banking for European banks, GoCardless closed to new accounts. Keys are stored unencrypted on the server.',
			source: ACTUAL_BANK_SYNC_DOC,
		},
		tracksTransactions: {
			longhand: 'No. Longhand Budget plans from recurring figures; it does not record purchases.',
			competitor: 'Yes. Envelope budgeting over every imported or typed transaction.',
		},
		manualEntry: {
			longhand: 'Yes, structured: income, expenses, savings, balances, each with a frequency',
			competitor: 'Yes, plus CSV, QIF, OFX and YNAB import',
		},
		accountRequired: {
			longhand: 'No for the free tier. An email address for premium sync.',
			competitor: 'No vendor account. A server password, which you set and keep.',
		},
		platforms: {
			longhand: 'Web app that installs as a PWA on phone and desktop; no native app store apps',
			competitor:
				'Web app (PWA) and a desktop app for Windows, Mac and Linux; the official mobile apps are deprecated and a phone needs a server.',
			source: ACTUAL_INSTALL_DOC,
		},
		offline: {
			longhand: 'Yes, the installed app keeps working offline',
			competitor: 'Yes, the budget file lives on the device',
		},
		dataLocation: {
			longhand:
				'Free tier: on your device only. Premium sync: servers in Germany, run by an EU host.',
			competitor:
				'On your device, synced to whichever server you run or rent; the region is your choice, or your host\u2019s.',
			source: ACTUAL_SYNC_DOC,
		},
		thirdParties: {
			longhand:
				'Free: none. Premium: the EU hosting provider stores your synced plan; Paddle sees billing, Brevo your sign-in email.',
			competitor:
				'None by default. Your hosting provider if you rent a server; SimpleFIN if you use bank feeds.',
		},
		forecasting: {
			longhand: 'Premium: saved what-if scenarios with projections. Free: a retirement projection.',
			competitor:
				'Schedules, experimental goal templates, a Crossover Point report and an experimental balance forecast; no saved what-if scenarios.',
			source: ACTUAL_REPORTS_DOC,
		},
		separateBudgets: {
			longhand: 'Premium profiles, switchable without mixing numbers',
			competitor: 'Multiple budget files on one server',
		},
		sharing: {
			longhand: 'No. One person per account.',
			competitor:
				'Anyone with access to your server; separate logins need an OpenID provider you configure.',
			source: ACTUAL_OAUTH_DOC,
		},
		reportsExport: {
			longhand: 'Premium: a PDF summary report. No CSV import or export.',
			competitor: 'Custom reports, net worth, full budget export and CSV',
		},
		adsTrackersAi: {
			longhand: 'No ads, no trackers, no AI features',
			competitor: 'None. Community funded through Open Collective.',
		},
	},
	competitorBetter: [
		'Everything is free: the app, unlimited devices and budget files, under an MIT licence.',
		'Optional end-to-end encryption, so even your sync server cannot read the budget.',
		'A desktop app for Windows, Mac and Linux that works on its own, with no server.',
		'Open source with a large community, a public roadmap and a release most months.',
		'Imports: CSV, QIF, OFX and a YNAB migration. Longhand Budget imports nothing.',
		'A bigger reporting engine: custom reports, net worth, a Crossover Point projection.',
		'It tracks every transaction in envelopes; Longhand Budget does not track spending at all.',
	],
	longhandBetter: [
		'Nothing to host. Actual\u2019s own docs call the browser-only version "not recommended for long-term use" and say a phone needs a server; Longhand Budget runs the moment the page loads.',
		'No server password to lose. Actual\u2019s optional encryption uses a second password that cannot be recovered.',
		'Privacy that the vendor is responsible for: premium sync is hosted in Germany by an EU provider, instead of wherever you or your host put the server.',
		'Saved what-if scenarios you can name and reload, instead of experimental forecast reports.',
		'A retirement projection on the free tier; Actual has no retirement or debt-payoff tool.',
		'Support from the vendor rather than a community Discord.',
		'Security updates are applied for you; self-hosting means you apply them yourself.',
	],
	switching:
		'There is no import. Actual Budget can export your budget as CSV, but Longhand Budget cannot read it: you enter each income, bill, savings goal and balance once, with its frequency. Your Actual data stays yours and on your server; nothing is deleted or converted.',
	faq: [
		{
			q: 'Do I need a server for Longhand Budget?',
			a: 'No. The free tier runs in your browser with nothing to install or host. The premium tier syncs through servers that Longhand Budget runs for you.',
		},
		{
			q: 'Is Actual Budget really free?',
			a: 'The software is, under an MIT licence. Running it on more than one device needs a server you host or rent (PikaPods from about $2 a month), and bank feeds through SimpleFIN cost $1.50 a month. A 2026 cost breakdown lands at about $33 a year for hosting plus feeds.',
		},
		{
			q: 'Which is more private?',
			a: 'Actual Budget on your own server with end-to-end encryption turned on is as private as software gets, if you run it well. Longhand Budget\u2019s free tier never leaves your browser. Longhand Budget\u2019s premium sync is hosted in Germany by an EU provider, so the hosting decision is made for you.',
		},
		{
			q: 'Can I import my Actual Budget data into Longhand Budget?',
			a: 'No. Longhand Budget has no import and no CSV export. You re-enter your recurring figures once; transactions are not something Longhand Budget records.',
		},
		{
			q: 'Does Longhand Budget track spending like Actual Budget?',
			a: 'No. Longhand Budget is a planner for the figures you already know. If you want envelopes and a transaction register, Actual Budget is the better fit.',
		},
	],
	sources: [
		{ label: 'Actual Budget: installing on PikaPods', url: ACTUAL_PIKAPODS_DOC },
		{ label: 'PikaPods app catalogue', url: PIKAPODS_CATALOGUE },
		{ label: 'Actual Budget: bank sync', url: ACTUAL_BANK_SYNC_DOC },
		{ label: 'SimpleFIN Bridge', url: SIMPLEFIN_BRIDGE },
		{ label: 'Actual Budget: installing', url: ACTUAL_INSTALL_DOC },
		{ label: 'Actual Budget: desktop app', url: ACTUAL_DESKTOP_DOC },
		{ label: 'Actual Budget: FAQ', url: ACTUAL_FAQ },
		{ label: 'Actual Budget: sync and encryption', url: ACTUAL_SYNC_DOC },
		{ label: 'Actual Budget: reports', url: ACTUAL_REPORTS_DOC },
		{ label: 'Actual Budget: balance forecast (experimental)', url: ACTUAL_FORECAST_DOC },
		{ label: 'Actual Budget: schedules', url: ACTUAL_SCHEDULES_DOC },
		{ label: 'Actual Budget: backup and export', url: ACTUAL_BACKUP_DOC },
		{ label: 'Actual Budget: OpenID logins', url: ACTUAL_OAUTH_DOC },
		{ label: 'Actual Budget: releases', url: ACTUAL_RELEASES },
		{ label: 'Actual Budget on GitHub', url: ACTUAL_GITHUB },
		{
			label: 'FinCompareLab: what Actual Budget really costs (2026)',
			url: FINCOMPARELAB_ACTUAL_COST,
		},
		{ label: 'Finny: Actual Budget review (2026)', url: FINNY_ACTUAL_REVIEW },
	],
}

export const COMPARE_PAGES: readonly ComparePage[] = [spreadsheet, actualBudget]

export function getComparePage(slug: string): ComparePage | undefined {
	return COMPARE_PAGES.find((page) => page.slug === slug)
}
