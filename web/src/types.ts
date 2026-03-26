export type SpacStatus = 'NORMAL' | 'MERGE_REVIEW' | 'MERGE_APPROVED'

export interface SpacItem {
  listingDate: string   // YYYY-MM-DD
  code: string
  name: string
  rate1: number
  rate2: number
  rate3: number
  expireDate: string    // YYYY-MM-DD
  status: SpacStatus
  daysLeft: number
  redemptionPrice: number | null  // 예상 청산가 (NORMAL만)
}

export interface MergeItem {
  nameKr: string
  code: string
  target: string
  dissentNoticeStartDate: string   // YYYYMMDD
  dissentNoticeEndDate: string
  appraisalRightStartDate: string
  appraisalRightEndDate: string
  tradingHaltStartDate: string
  tradingHaltEndDate: string
  newShareListingDate: string
  disclosureUrl: string
}
