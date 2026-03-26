import { useState } from 'react'
import type { SpacItem } from '../types'
import type { StockInfo } from '../firebase'

interface Props {
  items: SpacItem[]
  stockMap: Map<string, StockInfo>
  dartCodeMap: Map<string, string>
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

type SortKey = 'name' | 'rate1' | 'rate2' | 'rate3' | 'listingDate' | 'prevPrice'

export default function SpacTable({ items, stockMap, dartCodeMap }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('listingDate')
  const [sortAsc, setSortAsc] = useState(true)
  const [search, setSearch] = useState('')

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(a => !a)
    else { setSortKey(key); setSortAsc(true) }
  }

  const withPrice = items.map(item => {
    const stock = stockMap.get(item.code)
    const prevPrice = stock ? parseInt(stock.prevPrice as string, 10) : 0
    return { ...item, prevPrice }
  })

  const sorted = [...withPrice]
    .filter(i => !search || i.name.includes(search) || i.code.includes(search))
    .sort((a, b) => {
      const v = sortKey === 'name' ? a.name.localeCompare(b.name)
        : sortKey === 'listingDate' ? a.listingDate.localeCompare(b.listingDate)
        : sortKey === 'prevPrice' ? a.prevPrice - b.prevPrice
        : (a[sortKey as keyof typeof a] as number) - (b[sortKey as keyof typeof b] as number)
      return sortAsc ? v : -v
    })

  const Th = ({ label, k }: { label: string; k: SortKey }) => (
    <th
      onClick={() => handleSort(k)}
      style={{ padding: '10px 12px', textAlign: 'right', cursor: 'pointer', whiteSpace: 'nowrap',
        color: sortKey === k ? '#2563eb' : '#374151', userSelect: 'none', fontSize: 13 }}
    >
      {label} {sortKey === k ? (sortAsc ? '↑' : '↓') : ''}
    </th>
  )

  return (
    <div>
      <input
        placeholder="종목명 또는 코드 검색..."
        value={search}
        onChange={e => setSearch(e.target.value)}
        style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8,
          fontSize: 14, marginBottom: 12, boxSizing: 'border-box' }}
      />
      <div style={{ overflowX: 'auto', borderRadius: 10, border: '1px solid #e5e7eb' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead style={{ background: '#f9fafb' }}>
            <tr>
              <th style={{ padding: '10px 12px', textAlign: 'left', color: '#374151', fontSize: 13 }}>종목명</th>
              <th style={{ padding: '10px 12px', textAlign: 'left', color: '#374151', fontSize: 13 }}>코드</th>
              <th style={{ padding: '10px 12px', textAlign: 'left', color: '#374151', fontSize: 13 }}>상태</th>
              <Th label="전일종가" k="prevPrice" />
              <Th label="상장일" k="listingDate" />
              <Th label="1년차 %" k="rate1" />
              <Th label="2년차 %" k="rate2" />
              <Th label="3년차 %" k="rate3" />
              <th style={{ padding: '10px 12px', textAlign: 'center', color: '#374151', fontSize: 13 }}>전자공시</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((item, i) => {
              const st = STATUS_STYLE[item.status] ?? { background: '#f3f4f6', color: '#374151' }
              return (
                <tr key={item.code}
                  style={{ background: i % 2 === 0 ? '#fff' : '#f9fafb', borderTop: '1px solid #f3f4f6' }}>
                  <td style={{ padding: '10px 12px', fontWeight: 500 }}>{item.name}</td>
                  <td style={{ padding: '10px 12px', color: '#6b7280', fontFamily: 'monospace' }}>{item.code}</td>
                  <td style={{ padding: '10px 12px' }}>
                    <span style={{ ...st, padding: '2px 8px', borderRadius: 99, fontSize: 12, fontWeight: 600 }}>
                      {STATUS_LABEL[item.status] ?? item.status}
                    </span>
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'right',
                    fontWeight: 600, color: item.prevPrice > 0 ? '#1e293b' : '#9ca3af' }}>
                    {item.prevPrice > 0 ? item.prevPrice.toLocaleString() + '원' : '-'}
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', color: '#6b7280' }}>{item.listingDate}</td>

                  <td style={{ padding: '10px 12px', textAlign: 'right' }}>{(item.rate1 * 100).toFixed(2)}%</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right' }}>{(item.rate2 * 100).toFixed(2)}%</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right',
                    fontWeight: item.rate3 > 0 ? 600 : 400,
                    color: item.rate3 > 0 ? '#059669' : '#9ca3af' }}>
                    {item.rate3 > 0 ? `${(item.rate3 * 100).toFixed(2)}%` : '-'}
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                    <a
                      href={`https://dart.fss.or.kr/dsab001/main.do?autoSearch=true&textCrpNM=${item.code}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: '#2563eb', fontSize: 13, textDecoration: 'none' }}
                      title="DART 공시 보기"
                    >
                      📋
                    </a>
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
      <div style={{ marginTop: 8, color: '#9ca3af', fontSize: 12 }}>{sorted.length}개 종목</div>
    </div>
  )
}
