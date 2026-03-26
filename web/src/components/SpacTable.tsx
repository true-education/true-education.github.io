import { useState } from 'react'
import type { SpacItem } from '../types'

interface Props { items: SpacItem[] }

const STATUS_LABEL: Record<string, string> = {
  NORMAL: '일반',
  MERGE_REVIEW: '합병심사',
  MERGE_APPROVED: '합병승인',
}
const STATUS_STYLE: Record<string, { bg: string; color: string }> = {
  NORMAL:         { bg: '#dcfce7', color: '#166534' },
  MERGE_REVIEW:   { bg: '#fef9c3', color: '#854d0e' },
  MERGE_APPROVED: { bg: '#dbeafe', color: '#1e40af' },
}

type SortKey = 'daysLeft' | 'name' | 'rate1' | 'rate2' | 'rate3' | 'listingDate'

export default function SpacTable({ items }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('daysLeft')
  const [sortAsc, setSortAsc] = useState(true)
  const [search, setSearch] = useState('')

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(a => !a)
    else { setSortKey(key); setSortAsc(true) }
  }

  const sorted = [...items]
    .filter(i => !search || i.name.includes(search) || i.code.includes(search))
    .sort((a, b) => {
      const v = sortKey === 'name' ? a.name.localeCompare(b.name)
        : (a[sortKey] as number) - (b[sortKey] as number)
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
              <Th label="상장일" k="listingDate" />
              <Th label="청산예정일" k="daysLeft" />
              <Th label="D-day" k="daysLeft" />
              <Th label="1년차 %" k="rate1" />
              <Th label="2년차 %" k="rate2" />
              <Th label="3년차 %" k="rate3" />
            </tr>
          </thead>
          <tbody>
            {sorted.map((item, i) => {
              const st = STATUS_STYLE[item.status] ?? { bg: '#f3f4f6', color: '#374151' }
              const urgent = item.daysLeft <= 90 && item.status === 'NORMAL'
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
                  <td style={{ padding: '10px 12px', textAlign: 'right', color: '#6b7280' }}>{item.listingDate}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', color: '#6b7280' }}>{item.expireDate}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right',
                    color: urgent ? '#dc2626' : item.daysLeft <= 180 ? '#d97706' : '#374151',
                    fontWeight: urgent ? 700 : 400 }}>
                    D-{item.daysLeft}
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'right' }}>{(item.rate1 * 100).toFixed(2)}%</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right' }}>{(item.rate2 * 100).toFixed(2)}%</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right',
                    fontWeight: item.rate3 > 0 ? 600 : 400,
                    color: item.rate3 > 0 ? '#059669' : '#9ca3af' }}>
                    {item.rate3 > 0 ? `${(item.rate3 * 100).toFixed(2)}%` : '-'}
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
