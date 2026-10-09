export type ForecastingTab = 'scenarios' | 'projections' | 'saved'

// Static ids are safe: the page renders one tab strip, and they stay SSR-stable.
export const tabId = (tab: ForecastingTab): string => `forecasting-tab-${tab}`
export const tabPanelId = (tab: ForecastingTab): string => `forecasting-panel-${tab}`
