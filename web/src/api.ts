import type { SpacItem, MergeItem, SpacStatus } from './types'

const BASE = 'https://true-education.github.io/data'

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

export async function fetchSpacList(): Promise<SpacItem[]> {
  const res = await fetch(`${BASE}/v1.txt?_=${Date.now()}`)
  const text = await res.text()
  return text
    .split('\n')
    .filter(line => line.trim())
    .map(line => {
      const [listingDate, code, name, r1, r2, r3, expireDate, status] = line.split('\t')
      return {
        listingDate,
        code,
        name,
        rate1: parseFloat(r1),
        rate2: parseFloat(r2),
        rate3: parseFloat(r3),
        expireDate,
        status: status?.trim() as SpacStatus,
        daysLeft: daysLeft(expireDate),
      }
    })
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
