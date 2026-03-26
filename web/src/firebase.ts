import { initializeApp } from 'firebase/app'
import { getDatabase, ref, get, onValue, off } from 'firebase/database'

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
    // 리전 URL 명시적으로 전달
    db = getDatabase(app, firebaseConfig.databaseURL)
  }
} catch (e) {
  console.error('Firebase init failed:', e)
}

export interface StockInfo {
  code: string
  name: string
  market: string     // KOSPI / KOSDAQ
  sector?: string
  [key: string]: unknown
}

export async function fetchStocks(): Promise<Map<string, StockInfo>> {
  if (!db) return new Map()
  const stocksRef = ref(db, 'stocks')
  const snapshot = await get(stocksRef)
  const val = snapshot.val()
  if (!val) return new Map()

  const result = new Map<string, StockInfo>()
  const items = val['kosdaq'] ?? {}
  for (const [code, info] of Object.entries(items)) {
    const stock = info as StockInfo
    if (stock.spac) {
      result.set(code, { ...stock, code, market: 'KOSDAQ' })
    }
  }
  return result
}

export async function fetchLastUpdatedAt(): Promise<number> {
  if (!db) return 0
  const metaRef = ref(db, 'meta/stockLastUpdatedAt')
  const snapshot = await get(metaRef)
  return snapshot.val() ?? 0
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
  callback: (priceMap: SpacPriceMap, priceLastUpdatedAt: number) => void
): () => void {
  if (!db) return () => {}
  const priceRef = ref(db, 'spac/price')
  const handler = onValue(priceRef, snapshot => {
    const val = snapshot.val()
    if (!val) return callback(new Map(), 0)
    const result = new Map<string, SpacPriceInfo>()
    // lastUpdatedAt 은 yyyyMMddHHmm 포맷 숫자로 저장될 수 있음
    let updatedAt: number = (val['lastUpdatedAt'] as number) ?? 0
    for (const [code, info] of Object.entries(val)) {
      if (code === 'lastUpdatedAt') continue
      result.set(code, info as SpacPriceInfo)
    }
    callback(result, updatedAt)
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
