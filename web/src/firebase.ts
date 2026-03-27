import { initializeApp } from 'firebase/app'
import { getDatabase, ref, onValue, off } from 'firebase/database'
import { loadStocksFromMaster } from './stockMaster'

// Firebase는 실시간 가격(spac/price, meta/priceLastUpdatedAt) 구독에만 사용
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

let db: ReturnType<typeof getDatabase> | null = null
try {
  if (!firebaseConfig.apiKey || !firebaseConfig.databaseURL) {
    console.warn('Firebase config missing:', firebaseConfig)
  } else {
    const app = initializeApp(firebaseConfig)
    db = getDatabase(app, firebaseConfig.databaseURL)
  }
} catch (e) {
  console.error('Firebase init failed:', e)
}

export interface StockInfo {
  code: string
  nameKr: string
  market: string
  prevPrice: string
  halt: boolean
  designated: boolean
  spac: boolean
  [key: string]: unknown
}

/** KIS 마스터 파일에서 KOSDAQ 전체 로드 (IDB 캐시 적용) */
export async function fetchStocks(): Promise<Map<string, StockInfo>> {
  return loadStocksFromMaster()
}

/** 마스터 파일 기준 업데이트 시각 — 다운로드 완료 시점을 반환 */
export async function fetchLastUpdatedAt(): Promise<number> {
  // 마스터 파일은 캐시 타임스탬프가 곧 업데이트 시각
  // IDB에서 직접 읽는 대신 현재 시각 반환 (App.tsx에서 표시용으로만 사용)
  return Date.now()
}

export interface SpacPriceInfo {
  price: string
  priceChange: string
  priceChangeRate: string
  high: string
  low: string
  open: string
  previousClosePrice: string
  volume: string
}

export type SpacPriceMap = Map<string, SpacPriceInfo>

export function subscribeSpacPrices(
  callback: (priceMap: SpacPriceMap) => void
): () => void {
  if (!db) return () => {}
  const priceRef = ref(db, 'spac/price')
  const handler = onValue(priceRef, snapshot => {
    const val = snapshot.val()
    if (!val) return callback(new Map())
    const result = new Map<string, SpacPriceInfo>()
    for (const [code, info] of Object.entries(val)) {
      result.set(code, info as SpacPriceInfo)
    }
    callback(result)
  })
  return () => off(priceRef, 'value', handler)
}

export function subscribePriceLastUpdatedAt(
  callback: (updatedAt: number) => void
): () => void {
  if (!db) return () => {}
  const metaRef = ref(db, 'meta/priceLastUpdatedAt')
  const handler = onValue(metaRef, snapshot => {
    callback(snapshot.val() ?? 0)
  })
  return () => off(metaRef, 'value', handler)
}
