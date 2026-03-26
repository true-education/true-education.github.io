import { useState, useEffect } from 'react'
import type { SpacItem } from '../types'
import type { StockInfo, SpacPriceMap } from '../firebase'
import type { RefundInfo } from '../api'
import RedemptionPopup from './RedemptionPopup'
import FoundersPopup, { type FounderEntry } from './FoundersPopup'

interface Props {
  items: SpacItem[]
  stockMap: Map<string, StockInfo>
  priceMap?: SpacPriceMap
  refundMap?: Map<string, RefundInfo>
  foundersMap?: Map<string, FounderEntry>
}

const STATUS_LABEL: Record<string, string> = {
  NORMAL: '일반',
  MERGE_REVIEW: '합병심사',
  MERGE_APPROVED: '합병승인',
}
const STATUS_STYLE: Record<string, { background: string; color: string }> = {
  NORMAL:         { background: '#dcfce7', color: '#166534' },
  MERGE_REVIEW:   { background: '#fef9c3', color: '#854d0e' },
  MERGE_APPROVED: { background: '#dbeafe', color: '#1e40af' },
}

type SortKey = 'name' | 'redemptionPrice' | 'listingDate' | 'prevPrice'

// OHLCV 툴팁 컴포넌트
function PriceCell({ price, liveInfo }: {
  price: number
  liveInfo?: { open: string; high: string; low: string; previousClosePrice: string; volume: string; priceChange: string; priceChangeRate: string }
}) {
  const [show, setShow] = useState(false)
  const fmt = (s: string) => parseInt(s, 10).toLocaleString()
  const change = liveInfo ? parseInt(liveInfo.priceChange, 10) : 0
  const changeColor = change > 0 ? '#dc2626' : change < 0 ? '#2563eb' : '#6b7280'
  const changeSign = change > 0 ? '+' : ''

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      <span style={{ fontWeight: 600, color: price > 0 ? '#1e293b' : '#9ca3af', cursor: liveInfo ? 'default' : undefined }}>
        {price > 0 ? price.toLocaleString() + '원' : '-'}
      </span>
      {liveInfo && change !== 0 && (
        <span style={{ marginLeft: 4, fontSize: 11, color: changeColor }}>
          {changeSign}{change.toLocaleString()}
        </span>
      )}
      {show && liveInfo && (
        <div style={{
          position: 'absolute', right: 0, top: '100%', marginTop: 4, zIndex: 50,
          background: '#1e293b', color: '#f8fafc', borderRadius: 8, padding: '10px 14px',
          fontSize: 12, whiteSpace: 'nowrap', boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
          lineHeight: 1.8,
        }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'auto auto', columnGap: 12 }}>
            <span style={{ color: '#94a3b8' }}>시가</span><span>{fmt(liveInfo.open)}</span>
            <span style={{ color: '#94a3b8' }}>고가</span><span style={{ color: '#fca5a5' }}>{fmt(liveInfo.high)}</span>
            <span style={{ color: '#94a3b8' }}>저가</span><span style={{ color: '#93c5fd' }}>{fmt(liveInfo.low)}</span>
            <span style={{ color: '#94a3b8' }}>전일</span><span>{fmt(liveInfo.previousClosePrice)}</span>
            <span style={{ color: '#94a3b8' }}>등락</span>
            <span style={{ color: changeColor }}>{changeSign}{change.toLocaleString()} ({changeSign}{liveInfo.priceChangeRate}%)</span>
            <span style={{ color: '#94a3b8' }}>거래량</span><span>{parseInt(liveInfo.volume, 10).toLocaleString()}</span>
          </div>
        </div>
      )}
    </div>
  )
}

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 640)
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 640)
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])
  return isMobile
}

export default function SpacTable({ items, stockMap, priceMap, refundMap, foundersMap }: Props) {
  const isMobile = useIsMobile()
  const [sortKey, setSortKey] = useState<SortKey>('listingDate')
  const [sortAsc, setSortAsc] = useState(true)
  const [search, setSearch] = useState('')
  const [popupItem, setPopupItem] = useState<SpacItem | null>(null)
  const [foundersEntry, setFoundersEntry] = useState<FounderEntry | null>(null)

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(a => !a)
    else { setSortKey(key); setSortAsc(true) }
  }

  const withPrice = items.map(item => {
    const stock = stockMap.get(item.code)
    const stockPrice = stock ? parseInt(stock.prevPrice as string, 10) : 0
    // spac/price 실시간 가격 우선, 없으면 stocks 전일종가
    const livePrice = priceMap?.get(item.code)
    const prevPrice = livePrice ? parseInt(livePrice.price, 10) : stockPrice
    // refundMap에 있으면 해당 값 우선, 없으면 계산값 사용
    const refund = refundMap?.get(item.code)
    const redemptionPrice = refund ? Math.round(refund.refundAmount) : item.redemptionPrice
    return { ...item, prevPrice, redemptionPrice }
  })

  const sorted = [...withPrice]
    .filter(i => !search || i.name.includes(search) || i.code.includes(search))
    .sort((a, b) => {
      const v = sortKey === 'name' ? a.name.localeCompare(b.name)
        : sortKey === 'listingDate' ? a.listingDate.localeCompare(b.listingDate)
        : sortKey === 'prevPrice' ? a.prevPrice - b.prevPrice
        : sortKey === 'redemptionPrice' ? (a.redemptionPrice ?? 0) - (b.redemptionPrice ?? 0)
        : 0
      return sortAsc ? v : -v
    })

  // 정렬 버튼 (모바일 상단용)
  const SORT_OPTIONS: { label: string; k: SortKey }[] = [
    { label: '상장일', k: 'listingDate' },
    { label: '종가', k: 'prevPrice' },
    { label: '청산가', k: 'redemptionPrice' },
  ]

  const Th = ({ label, k }: { label: string; k: SortKey }) => (
    <th
      onClick={() => handleSort(k)}
      style={{ padding: '10px 12px', textAlign: 'right', cursor: 'pointer', whiteSpace: 'nowrap',
        color: sortKey === k ? '#2563eb' : '#374151', userSelect: 'none', fontSize: 13 }}
    >
      {label} {sortKey === k ? (sortAsc ? '↑' : '↓') : ''}
    </th>
  )

  // ── 공통: 종목명 셀 내용 ────────────────────────────────────────────────────
  const NameCell = ({ item }: { item: typeof sorted[0] }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      {foundersMap?.has(item.code) && (
        <button
          onClick={() => setFoundersEntry(foundersMap.get(item.code)!)}
          title="발기인 정보"
          style={{ border: 'none', background: 'none', cursor: 'pointer',
            padding: 0, lineHeight: 1, flexShrink: 0, color: '#9ca3af', fontSize: 15,
            display: 'inline-flex', alignItems: 'center' }}
          onMouseEnter={e => (e.currentTarget.style.color = '#2563eb')}
          onMouseLeave={e => (e.currentTarget.style.color = '#9ca3af')}
        >ⓘ</button>
      )}
      <a
        href={`https://finance.naver.com/item/main.naver?code=${item.code}`}
        target="_blank" rel="noopener noreferrer"
        style={{ color: 'inherit', textDecoration: 'none', fontWeight: 600 }}
        onMouseEnter={e => (e.currentTarget.style.textDecoration = 'underline')}
        onMouseLeave={e => (e.currentTarget.style.textDecoration = 'none')}
      >{item.name}</a>
      {stockMap.get(item.code)?.halt && (
        <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 14, height: 14, fontSize: 9, fontWeight: 700,
          background: '#BA1A1A', color: '#fff', flexShrink: 0 }}>정</span>
      )}
      {stockMap.get(item.code)?.designated && (
        <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 14, height: 14, fontSize: 9, fontWeight: 700,
          background: '#F57C00', color: '#fff', flexShrink: 0 }}>관</span>
      )}
    </div>
  )

  return (
    <div>
      {/* 검색 */}
      <input
        placeholder="종목명 또는 코드 검색..."
        value={search}
        onChange={e => setSearch(e.target.value)}
        style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8,
          fontSize: 14, marginBottom: 12, boxSizing: 'border-box' }}
      />

      {/* ── 모바일: 정렬 버튼 + 카드 뷰 ─────────────────────────────────── */}
      {isMobile ? (
        <>
          {/* 정렬 버튼 */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
            {SORT_OPTIONS.map(({ label, k }) => (
              <button key={k} onClick={() => handleSort(k)}
                style={{
                  padding: '5px 12px', borderRadius: 99, fontSize: 12, cursor: 'pointer',
                  border: sortKey === k ? '1px solid #2563eb' : '1px solid #d1d5db',
                  background: sortKey === k ? '#eff6ff' : '#fff',
                  color: sortKey === k ? '#2563eb' : '#374151',
                  fontWeight: sortKey === k ? 700 : 400,
                }}>
                {label} {sortKey === k ? (sortAsc ? '↑' : '↓') : ''}
              </button>
            ))}
          </div>

          {/* 카드 목록 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {sorted.map(item => {
              const st = STATUS_STYLE[item.status] ?? { background: '#f3f4f6', color: '#374151' }
              return (
                <div key={item.code} style={{
                  border: '1px solid #e5e7eb', borderRadius: 12, padding: '12px 14px',
                  background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.05)'
                }}>
                  {/* 상단: 종목명 + 상태 */}
                  <div style={{ display: 'flex', justifyContent: 'space-between',
                    alignItems: 'center', marginBottom: 8, gap: 8 }}>
                    <NameCell item={item} />
                    <span style={{ ...st, padding: '2px 8px', borderRadius: 99,
                      fontSize: 11, fontWeight: 600, flexShrink: 0, whiteSpace: 'nowrap' }}>
                      {STATUS_LABEL[item.status] ?? item.status}
                    </span>
                  </div>

                  {/* 하단: 수치 그리드 */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr',
                    gap: '4px 0', fontSize: 12 }}>
                    <div style={{ color: '#9ca3af' }}>코드</div>
                    <div style={{ color: '#9ca3af' }}>현재 가격</div>
                    <div style={{ color: '#9ca3af' }}>상장일</div>

                    <div style={{ fontFamily: 'monospace', color: '#6b7280' }}>{item.code}</div>
                    <div>
                      <PriceCell price={item.prevPrice} liveInfo={priceMap?.get(item.code)} />
                    </div>
                    <div style={{ color: '#6b7280' }}>{item.listingDate}</div>
                  </div>

                  {/* 예상 청산가 + DART */}
                  <div style={{ display: 'flex', justifyContent: 'space-between',
                    alignItems: 'center', marginTop: 8, paddingTop: 8,
                    borderTop: '1px solid #f3f4f6' }}>
                    <div style={{ fontSize: 12 }}>
                      <span style={{ color: '#9ca3af', marginRight: 6 }}>예상 청산가</span>
                      {item.redemptionPrice ? (
                        <button
                          onClick={() => setPopupItem(item)}
                          style={{ background: 'none', border: 'none', cursor: 'pointer',
                            fontWeight: 600, color: '#059669', fontSize: 13, padding: 0,
                            textDecoration: 'underline dotted' }}>
                          {item.redemptionPrice.toLocaleString()}원
                        </button>
                      ) : <span style={{ color: '#9ca3af' }}>-</span>}
                    </div>
                    <a href={`https://dart.fss.or.kr/dsab001/main.do?autoSearch=true&textCrpNM=${item.code}`}
                      target="_blank" rel="noopener noreferrer"
                      style={{ fontSize: 16, textDecoration: 'none' }} title="DART 공시 보기">
                      📋
                    </a>
                  </div>
                </div>
              )
            })}
          </div>
        </>
      ) : (
        /* ── 데스크탑: 기존 테이블 ─────────────────────────────────────── */
        <div style={{ overflowX: 'auto', borderRadius: 10, border: '1px solid #e5e7eb' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead style={{ background: '#f9fafb' }}>
              <tr>
                <th style={{ padding: '10px 12px', textAlign: 'left', color: '#374151', fontSize: 13 }}>종목명</th>
                <th style={{ padding: '10px 12px', textAlign: 'left', color: '#374151', fontSize: 13 }}>코드</th>
                <th style={{ padding: '10px 12px', textAlign: 'left', color: '#374151', fontSize: 13 }}>상태</th>
                <Th label="현재 가격" k="prevPrice" />
                <Th label="상장일" k="listingDate" />
                <Th label="예상 청산가" k="redemptionPrice" />
                <th style={{ padding: '10px 12px', textAlign: 'center', color: '#374151', fontSize: 13 }}>전자공시</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((item, i) => {
                const st = STATUS_STYLE[item.status] ?? { background: '#f3f4f6', color: '#374151' }
                return (
                  <tr key={item.code}
                    style={{ background: i % 2 === 0 ? '#fff' : '#f9fafb', borderTop: '1px solid #f3f4f6' }}>
                    <td style={{ padding: '10px 12px', fontWeight: 500 }}>
                      <NameCell item={item} />
                    </td>
                    <td style={{ padding: '10px 12px', color: '#6b7280', fontFamily: 'monospace' }}>{item.code}</td>
                    <td style={{ padding: '10px 12px' }}>
                      <span style={{ ...st, padding: '2px 8px', borderRadius: 99, fontSize: 12, fontWeight: 600 }}>
                        {STATUS_LABEL[item.status] ?? item.status}
                      </span>
                    </td>
                    <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                      <PriceCell price={item.prevPrice} liveInfo={priceMap?.get(item.code)} />
                    </td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', color: '#6b7280' }}>{item.listingDate}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                      {item.redemptionPrice ? (
                        <button
                          onClick={() => setPopupItem(item)}
                          style={{ background: 'none', border: 'none', cursor: 'pointer',
                            fontWeight: 600, color: '#059669', fontSize: 13, padding: 0,
                            textDecoration: 'underline dotted' }}>
                          {item.redemptionPrice.toLocaleString()}원
                        </button>
                      ) : <span style={{ color: '#9ca3af' }}>-</span>}
                    </td>
                    <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                      <a href={`https://dart.fss.or.kr/dsab001/main.do?autoSearch=true&textCrpNM=${item.code}`}
                        target="_blank" rel="noopener noreferrer"
                        style={{ color: '#2563eb', fontSize: 13, textDecoration: 'none' }}
                        title="DART 공시 보기">📋</a>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {sorted.length === 0 && (
            <div style={{ padding: 40, textAlign: 'center', color: '#9ca3af' }}>검색 결과가 없습니다</div>
          )}
        </div>
      )}

      {sorted.length === 0 && isMobile && (
        <div style={{ padding: 40, textAlign: 'center', color: '#9ca3af' }}>검색 결과가 없습니다</div>
      )}
      <div style={{ marginTop: 8, color: '#9ca3af', fontSize: 12 }}>{sorted.length}개 종목</div>

      {popupItem && <RedemptionPopup item={popupItem} onClose={() => setPopupItem(null)} />}
      {foundersEntry && <FoundersPopup entry={foundersEntry} onClose={() => setFoundersEntry(null)} />}
    </div>
  )
}
