/* eslint-disable @typescript-eslint/no-explicit-any */
let amp: any = null

const API_KEY = import.meta.env.VITE_AMPLITUDE_API_KEY as string | undefined

// Function() trick: tsc가 모듈 경로를 정적 분석하지 않음
const dynamicImport = (m: string): Promise<any> =>
  (Function('m', 'return import(m)') as (m: string) => Promise<any>)(m)

export async function initAnalytics() {
  if (!API_KEY) return
  amp = await dynamicImport('@amplitude/analytics-browser')
  amp.init(API_KEY, {
    defaultTracking: {
      pageViews: false,
      sessions: true,
      formInteractions: false,
      fileDownloads: false,
    },
  })
}

export function trackPageView(page: string, properties?: Record<string, unknown>) {
  amp?.track('page_view', { page, ...properties })
}

export function trackButtonClick(buttonType: string, stockName?: string, properties?: Record<string, unknown>) {
  amp?.track('button_click', {
    button_type: buttonType,
    ...(stockName ? { stock_name: stockName } : {}),
    ...properties,
  })
}

export function trackFilterChange(filter: string) {
  amp?.track('filter_change', { filter })
}

export function trackSortChange(sort_key: string, sort_asc: boolean) {
  amp?.track('sort_change', { sort_key, sort_asc })
}
