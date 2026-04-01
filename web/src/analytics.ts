import * as amplitude from '@amplitude/analytics-browser'

const API_KEY = import.meta.env.VITE_AMPLITUDE_API_KEY as string

export function initAnalytics() {
  if (!API_KEY) return
  amplitude.init(API_KEY, {
    defaultTracking: {
      pageViews: false, // 수동으로 추적
      sessions: true,
      formInteractions: false,
      fileDownloads: false,
    },
  })
}

/** 화면/탭 전환 */
export function trackPageView(page: string, properties?: Record<string, unknown>) {
  amplitude.track('page_view', { page, ...properties })
}

/** 버튼 클릭 (종목 이름 + 버튼 종류) */
export function trackButtonClick(buttonType: string, stockName?: string, properties?: Record<string, unknown>) {
  amplitude.track('button_click', {
    button_type: buttonType,
    ...(stockName ? { stock_name: stockName } : {}),
    ...properties,
  })
}

/** 필터 변경 */
export function trackFilterChange(filter: string) {
  amplitude.track('filter_change', { filter })
}

/** 정렬 변경 */
export function trackSortChange(sort_key: string, sort_asc: boolean) {
  amplitude.track('sort_change', { sort_key, sort_asc })
}
