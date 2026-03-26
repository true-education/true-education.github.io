import { initializeApp } from 'firebase/app'
import { getDatabase, ref, get } from 'firebase/database'

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
