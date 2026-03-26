import { initializeApp } from 'firebase/app'
import { getDatabase, ref, get } from 'firebase/database'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

const app = initializeApp(firebaseConfig)
const db = getDatabase(app)

export interface StockInfo {
  code: string
  name: string
  market: string     // KOSPI / KOSDAQ
  sector?: string
  [key: string]: unknown
}

export async function fetchStocks(): Promise<Map<string, StockInfo>> {
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
  const metaRef = ref(db, 'meta/stockLastUpdatedAt')
  const snapshot = await get(metaRef)
  return snapshot.val() ?? 0
}
