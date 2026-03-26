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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {sorted.map(item => {
        const days = daysLeft(item.date)
        const isUrgent = days >= 0 && days <= 7
        const isPast = days < 0

        const dDayLabel = isPast ? '완료' : days === 0 ? 'D-day' : `D-${days}`
        const dDayColor = isPast ? '#9ca3af' : isUrgent ? '#dc2626' : '#2563eb'
        const dDayBg   = isPast ? '#f3f4f6' : isUrgent ? '#fee2e2' : '#eff6ff'

        return (
          <div key={item.code} style={{
            border: `1px solid ${isUrgent ? '#fca5a5' : '#e5e7eb'}`,
            borderRadius: 12,
            padding: '12px 16px',
            background: isUrgent ? '#fff7f7' : '#fff',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}>
            {/* D-day 배지 */}
            <div style={{
              flexShrink: 0,
              width: 52, height: 52,
              borderRadius: 12,
              background: dDayBg,
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
            }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: dDayColor, lineHeight: 1 }}>
                {dDayLabel}
              </span>
            </div>

            {/* 종목 정보 */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 700, fontSize: 15, overflow: 'hidden',
                  textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {item.nameKr}
                </span>
                {item.fixed && (
                  <span style={{ padding: '1px 7px', borderRadius: 99, fontSize: 11, fontWeight: 600,
                    background: '#ede9fe', color: '#6d28d9', flexShrink: 0 }}>확정</span>
                )}
              </div>
              <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 2 }}>
                {item.code} · {parseDate(item.date)}
              </div>
            </div>

            {/* 청산가 */}
            <div style={{ flexShrink: 0, textAlign: 'right' }}>
              <div style={{ fontSize: 11, color: '#9ca3af' }}>예상 청산가</div>
              <div style={{ fontWeight: 700, fontSize: 17, color: '#059669', marginTop: 1 }}>
                {Math.round(item.refundAmount).toLocaleString()}원
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
