import { useEffect, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { fetchSpacList, fetchMergeList } from './api'
import { fetchStocks, fetchLastUpdatedAt, subscribeSpacPrices, subscribePriceLastUpdatedAt } from './firebase'
import type { StockInfo, SpacPriceMap } from './firebase'
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
  const [priceMap, setPriceMap] = useState<SpacPriceMap>(new Map())
  const [priceLastUpdatedAt, setPriceLastUpdatedAt] = useState<number>(0)
  // null = 아직 응답 없음(로딩), 0 = 데이터 없음, >0 = 실제 값
  const [priceAvailable, setPriceAvailable] = useState<boolean | null>(null)

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
    ]).then(([s, m, stocks, ts]) => {
      setSpacList(s)
      setMergeList(m)
      setStockMap(stocks)
      setLastUpdated(ts)
    }).finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    const unsubscribe = subscribeSpacPrices(map => {
      setPriceMap(map)
      setPriceAvailable(map.size > 0)
    })
    return unsubscribe
  }, [])

  useEffect(() => {
    const unsubscribe = subscribePriceLastUpdatedAt(at => {
      if (at > 0) setPriceLastUpdatedAt(at)
    })
    return unsubscribe
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

  // 실시간 가격 기준 시각 및 오늘 여부
  const priceLastUpdatedStr = priceLastUpdatedAt > 0
    ? (() => {
        const s = String(priceLastUpdatedAt)
        return `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)} ${s.slice(8,10)}:${s.slice(10,12)}`
      })()
    : null

  const isPriceToday = priceLastUpdatedAt > 0
    ? (() => {
        const s = String(priceLastUpdatedAt)
        const today = new Date()
        const ymd = `${today.getFullYear()}${String(today.getMonth()+1).padStart(2,'0')}${String(today.getDate()).padStart(2,'0')}`
        return s.slice(0, 8) === ymd
      })()
    : false

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
          {priceLastUpdatedStr
            ? <div>가격 기준 시간: {priceLastUpdatedStr}{!isPriceToday && ' (전일 종가)'}</div>
            : priceAvailable === false
              ? <div>가격 기준 시간: — (전일 종가)</div>
              : lastUpdatedStr && <div>가격 기준 시간: {lastUpdatedStr}</div>
          }
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
      {tab === 'list' && <SpacTable items={filtered} stockMap={stockMap} priceMap={priceMap} isPriceToday={isPriceToday} priceAvailable={priceAvailable ?? false} />}
      {tab === 'merge' && <MergeTimeline items={mergeList} spacList={spacList} />}

      {/* 푸터 */}
      <div style={{ marginTop: 48, paddingTop: 24, borderTop: '1px solid #e5e7eb', textAlign: 'center' }}>
        <p style={{ fontSize: 13, color: '#9ca3af', marginBottom: 20 }}>
          더 많은 기능은 앱에서 확인하세요
        </p>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 32,
          padding: '20px 32px', borderRadius: 12, border: '1px solid #e5e7eb', background: '#fff' }}>
          {/* QR 코드 */}
          <div style={{ textAlign: 'center' }}>
            <QRCodeSVG
              value="https://play.google.com/store/apps/details?id=com.trueedu.spac"
              size={120}
            />
            <p style={{ fontSize: 11, color: '#9ca3af', marginTop: 6 }}>QR 스캔</p>
          </div>
          {/* 다운로드 버튼 */}
          <div style={{ textAlign: 'left' }}>
            <p style={{ fontSize: 14, fontWeight: 600, color: '#1e293b', marginBottom: 12 }}>
              SPAC 앱 다운로드
            </p>
            <a
              href="https://play.google.com/store/apps/details?id=com.trueedu.spac"
              target="_blank"
              rel="noopener noreferrer"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 8,
                padding: '10px 20px', borderRadius: 8, textDecoration: 'none',
                background: '#000', color: '#fff', fontSize: 14, fontWeight: 500 }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M3.18 23.76c.32.18.68.22 1.04.12l11.8-6.8-2.48-2.48-10.36 9.16zM20.44 10.2L17.5 8.54l-2.82 2.82 2.82 2.82 2.96-1.7c.84-.48.84-1.8-.02-2.28zM4.22.12C3.86.02 3.5.06 3.18.24L13.56 10.6l2.48-2.48L4.22.12zM3 1.42v21.16l10.34-10.58L3 1.42z"/>
              </svg>
              Google Play
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}
