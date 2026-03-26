import { initializeApp } from 'firebase/app'
import { getDatabase, ref, get } from 'firebase/database'

const firebaseConfig = {
  apiKey: 'AIzaSyBkGEUFFFpcjOFW020ocrDJb2IL3dWXcqk',
  projectId: 'true-project-9bd97',
  databaseURL: 'https://true-project-9bd97-default-rtdb.asia-southeast1.firebasedatabase.app',
  storageBucket: 'true-project-9bd97.appspot.com',
  appId: '1:581599038344:android:b93f44c85aff021025483d',
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
  for (const market of ['kospi', 'kosdaq']) {
    const items = val[market] ?? {}
    for (const [code, info] of Object.entries(items)) {
      result.set(code, { ...(info as object), code, market: market.toUpperCase() } as StockInfo)
    }
  }
  return result
}

export async function fetchLastUpdatedAt(): Promise<number> {
  const metaRef = ref(db, 'meta/stockLastUpdatedAt')
  const snapshot = await get(metaRef)
  return snapshot.val() ?? 0
}
