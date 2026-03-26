import { useEffect, useState } from 'react'
import { fetchSpacList, fetchMergeList, fetchDartCodeMap } from './api'
import { fetchStocks, fetchLastUpdatedAt } from './firebase'
import type { StockInfo } from './firebase'
import type { SpacItem, MergeItem, SpacStatus } from './types'
import SpacTable from './components/SpacTable'
import MergeTimeline from './components/MergeTimeline'
import SummaryCards from './components/SummaryCards'

type Tab = 'list' | 'merge'
type Filter = 'ALL' | SpacStatus

export default function App() {
  const [spacList, setSpacList] = useState<SpacItem[]>([])
  const [mergeList, setMergeList] = useState<MergeItem[]>([])
  const [stockMap, setStockMap] = useState<Map<string, StockInfo>>(new Map())
  const [dartCodeMap, setDartCodeMap] = useState<Map<string, string>>(new Map())
  const [lastUpdated, setLastUpdated] = useState<number>(0)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('list')
  const [filter, setFilter] = useState<Filter>('ALL')

  useEffect(() => {
    Promise.all([
      fetchSpacList(),
      fetchMergeList(),
      fetchStocks(),
      fetchLastUpdatedAt(),
      fetchDartCodeMap(),
    ]).then(([s, m, stocks, ts, dartMap]) => {
      setSpacList(s)
      setMergeList(m)
      setStockMap(stocks)
      setLastUpdated(ts)
      setDartCodeMap(dartMap)
    }).finally(() => setLoading(false))
  }, [])

  const filtered = filter === 'ALL' ? spacList : spacList.filter(s => s.status === filter)

  const counts = {
    total: spacList.length,
    normal: spacList.filter(s => s.status === 'NORMAL').length,
    review: spacList.filter(s => s.status === 'MERGE_REVIEW').length,
    approved: spacList.filter(s => s.status === 'MERGE_APPROVED').length,
  }

  // 마지막 업데이트 시각 포맷 (yyyyMMddHHmm)
  const lastUpdatedStr = lastUpdated
    ? (() => {
        const s = String(lastUpdated)
        return `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)} ${s.slice(8,10)}:${s.slice(10,12)}`
      })()
    : null

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: '#666' }}>
      데이터 로딩 중...
    </div>
  )

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 16px', fontFamily: 'system-ui, sans-serif' }}>
      {/* 헤더 */}
      <div style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>📊 SPAC 현황판</h1>
          <p style={{ color: '#888', margin: '4px 0 0', fontSize: 14 }}>
            국내 기업인수목적회사(SPAC) 예치금리 및 합병 일정 현황
          </p>
        </div>
        <div style={{ textAlign: 'right', fontSize: 12, color: '#9ca3af', lineHeight: 1.6 }}>
          {lastUpdatedStr && <div>종가 기준일: {lastUpdatedStr}</div>}
          <div>
            build {__BUILD_DATE__} ({__BUILD_HASH__})
          </div>
        </div>
      </div>

      {/* 요약 카드 */}
      <SummaryCards counts={counts} onFilter={setFilter} activeFilter={filter} />

      {/* 탭 */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, borderBottom: '1px solid #e5e7eb' }}>
        {(['list', 'merge'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: '8px 16px',
              border: 'none',
              background: 'none',
              cursor: 'pointer',
              fontWeight: tab === t ? 700 : 400,
              color: tab === t ? '#2563eb' : '#666',
              borderBottom: tab === t ? '2px solid #2563eb' : '2px solid transparent',
              marginBottom: -1,
            }}
          >
            {t === 'list' ? `전체 목록 (${spacList.length})` : `합병 진행 (${mergeList.length})`}
          </button>
        ))}
      </div>

      {/* 컨텐츠 */}
      {tab === 'list' && <SpacTable items={filtered} stockMap={stockMap} dartCodeMap={dartCodeMap} />}
      {tab === 'merge' && <MergeTimeline items={mergeList} spacList={spacList} />}
    </div>
  )
}
