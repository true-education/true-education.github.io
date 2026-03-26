import type { RefundInfo } from '../api'

interface Props {
  items: RefundInfo[]
}

function parseDate(s: string): string {
  if (s.length === 8) return `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`
  return s
}

function daysLeft(dateStr: string): number {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const target = new Date(parseDate(dateStr))
  return Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
}

export default function RefundList({ items }: Props) {
  if (items.length === 0) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: '#9ca3af' }}>
        청산 예정 종목이 없습니다
      </div>
    )
  }

  const sorted = [...items].sort((a, b) => a.date.localeCompare(b.date))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {sorted.map(item => {
        const days = daysLeft(item.date)
        const isUrgent = days <= 7
        const isPast = days < 0

        return (
          <div key={item.code} style={{
            border: `1px solid ${isUrgent && !isPast ? '#fca5a5' : '#e5e7eb'}`,
            borderRadius: 12,
            padding: '14px 18px',
            background: isUrgent && !isPast ? '#fff7f7' : '#fff',
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            flexWrap: 'wrap',
          }}>
            {/* 종목명 + 코드 */}
            <div style={{ flex: 1, minWidth: 160 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontWeight: 700, fontSize: 15 }}>{item.nameKr}</span>
                {item.fixed && (
                  <span style={{ padding: '1px 7px', borderRadius: 99, fontSize: 11, fontWeight: 600,
                    background: '#ede9fe', color: '#6d28d9' }}>확정</span>
                )}
              </div>
              <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 2, fontFamily: 'monospace' }}>
                {item.code}
              </div>
            </div>

            {/* 청산 예정일 + D-day */}
            <div style={{ textAlign: 'center', minWidth: 100 }}>
              <div style={{ fontSize: 13, color: '#6b7280' }}>청산 예정일</div>
              <div style={{ fontWeight: 600, fontSize: 14, marginTop: 2 }}>{parseDate(item.date)}</div>
              <div style={{
                marginTop: 3, fontSize: 12, fontWeight: 600,
                color: isPast ? '#9ca3af' : isUrgent ? '#dc2626' : '#2563eb',
              }}>
                {isPast ? '청산 완료' : days === 0 ? 'D-day' : `D-${days}`}
              </div>
            </div>

            {/* 예상 청산가 */}
            <div style={{ textAlign: 'right', minWidth: 110 }}>
              <div style={{ fontSize: 13, color: '#6b7280' }}>예상 청산가</div>
              <div style={{ fontWeight: 700, fontSize: 18, color: '#059669', marginTop: 2 }}>
                {Math.round(item.refundAmount).toLocaleString()}원
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
