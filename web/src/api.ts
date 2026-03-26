import type { SpacItem, MergeItem, SpacStatus } from './types'
import type { FounderEntry } from './components/FoundersPopup'

const BASE = 'https://true-education.github.io/data'

// ── 로컬 파일 기반 refund ────────────────────────────────────────────────────

export interface RefundInfo {
  code: string
  nameKr: string
  refundAmount: number
  date: string
  fixed: boolean
}

export async function fetchRefundLocal(): Promise<Map<string, RefundInfo>> {
  try {
    const res = await fetch(`${BASE}/refund.json?_=${Date.now()}`)
    const data: Record<string, RefundInfo> = await res.json()
    return new Map(Object.entries(data))
  } catch {
    return new Map()
  }
}

function parseDate(s: string): string {
  if (s.length === 8) return `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`
  return s
}

function daysLeft(expireDate: string): number {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const target = new Date(expireDate)
  return Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
}

/**
 * 예상 청산가 계산 (spac 앱 SpacRefund.settlementAmount() 동일 로직)
 * - 공모가 2000원 고정
 * - 이자 소득세 15.4%, 신탁사 수수료 0.1%
 * - 3년차는 일할 계산
 */
function calcRedemptionPrice(
  r1: number, r2: number, r3: number,
  listingDate: string, expireDate: string
): number {
  const INCOME_TAX = 0.154
  const TRUST_FEE  = 0.001
  let p = 2000.0

  // 1년차
  const i1 = p * r1
  p = p + i1 - i1 * INCOME_TAX - p * TRUST_FEE

  // 2년차
  const i2 = p * r2
  p = p + i2 - i2 * INCOME_TAX - p * TRUST_FEE

  // 3년차 일할
  const listing = new Date(listingDate).getTime()
  const expire  = new Date(expireDate).getTime()
  const totalDays = (expire - listing) / (1000 * 60 * 60 * 24)
  const remainingDays = totalDays - 730
  const ratio = remainingDays / 365.0
  const i3 = p * r3 * ratio
  p = p + i3 - i3 * INCOME_TAX - p * TRUST_FEE * ratio

  return Math.round(p)
}

export async function fetchSpacList(): Promise<SpacItem[]> {
  const res = await fetch(`${BASE}/v1.txt?_=${Date.now()}`)
  const text = await res.text()
  return text
    .split('\n')
    .filter(line => line.trim())
    .map(line => {
      const [listingDate, code, name, r1s, r2s, r3s, expireDate, status] = line.split('\t')
      const r1 = parseFloat(r1s), r2 = parseFloat(r2s), r3 = parseFloat(r3s)
      const st = status?.trim() as SpacStatus
      const redemptionPrice = st === 'NORMAL' && r1 > 0 && r2 > 0 && r3 > 0
        ? calcRedemptionPrice(r1, r2, r3, listingDate, expireDate)
        : null
      return {
        listingDate,
        code,
        name,
        rate1: r1,
        rate2: r2,
        rate3: r3,
        expireDate,
        status: st,
        daysLeft: daysLeft(expireDate),
        redemptionPrice,
      }
    })
}

/** dart.txt → code: corp_code 매핑 */
export async function fetchDartCodeMap(): Promise<Map<string, string>> {
  const res = await fetch(`${BASE}/dart.txt?_=${Date.now()}`)
  const text = await res.text()
  const map = new Map<string, string>()
  text.split('\n').filter(l => l.trim()).forEach(line => {
    const [corpCode, , stockCode] = line.trim().split(/\s+/)
    if (stockCode) map.set(stockCode, corpCode)
  })
  return map
}

export async function fetchFounders(): Promise<Map<string, FounderEntry>> {
  try {
    const res = await fetch(`${BASE}/founders.json?_=${Date.now()}`)
    const data: FounderEntry[] = await res.json()
    const map = new Map<string, FounderEntry>()
    data.forEach(entry => map.set(entry.code, entry))
    return map
  } catch {
    return new Map()
  }
}

export async function fetchMergeList(): Promise<MergeItem[]> {
  const res = await fetch(`${BASE}/merge.txt?_=${Date.now()}`)
  const data = await res.json()
  return data.map((item: MergeItem) => ({
    ...item,
    dissentNoticeStartDate: parseDate(item.dissentNoticeStartDate),
    dissentNoticeEndDate: parseDate(item.dissentNoticeEndDate),
    appraisalRightStartDate: parseDate(item.appraisalRightStartDate),
    appraisalRightEndDate: parseDate(item.appraisalRightEndDate),
    tradingHaltStartDate: parseDate(item.tradingHaltStartDate),
    tradingHaltEndDate: parseDate(item.tradingHaltEndDate),
    newShareListingDate: parseDate(item.newShareListingDate),
  }))
}
