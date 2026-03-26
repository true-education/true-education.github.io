import type { MergeItem, SpacItem } from '../types'

interface Props {
  items: MergeItem[]
  spacList: SpacItem[]
}

function TimelineRow({ label, start, end, today }: { label: string; start: string; end: string; today: string }) {
  const isActive = today >= start && today <= end
  const isPast = today > end
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
      <div style={{ width: 100, fontSize: 12, color: '#6b7280', flexShrink: 0 }}>{label}</div>
      <div style={{ flex: 1, background: '#f3f4f6', borderRadius: 4, height: 24, position: 'relative', overflow: 'hidden' }}>
        <div style={{
          position: 'absolute', inset: 0,
          background: isPast ? '#d1d5db' : isActive ? '#3b82f6' : '#93c5fd',
          opacity: isPast ? 0.5 : 1,
          borderRadius: 4,
        }} />
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
          justifyContent: 'center', fontSize: 11, color: isPast ? '#6b7280' : '#fff', fontWeight: 500 }}>
          {start.slice(5)} ~ {end.slice(5)}
          {isActive && ' 🔴 진행중'}
          {isPast && ' ✓'}
        </div>
      </div>
    </div>
  )
}

export default function MergeTimeline({ items, spacList }: Props) {
  const today = new Date().toISOString().slice(0, 10)

  if (items.length === 0) {
    return <div style={{ padding: 40, textAlign: 'center', color: '#9ca3af' }}>합병 진행 중인 종목이 없습니다</div>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {items.map(item => {
        const spac = spacList.find(s => s.code === item.code)
        return (
          <div key={item.code} style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 20 }}>
            {/* 헤더 */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontWeight: 700, fontSize: 16 }}>{item.nameKr}</span>
                  <span style={{ fontSize: 13, color: '#6b7280', fontFamily: 'monospace' }}>{item.code}</span>
                  {spac?.status === 'MERGE_REVIEW' && (
                    <span style={{
                      padding: '2px 8px', borderRadius: 99, fontSize: 12, fontWeight: 600,
                      background: '#fef9c3', color: '#854d0e',
                    }}>합병심사</span>
                  )}
                </div>
                <div style={{ marginTop: 4, fontSize: 14, color: '#374151' }}>
                  ➜ <strong>{item.target}</strong> 합병
                </div>
              </div>
              <a href={item.disclosureUrl} target="_blank" rel="noopener noreferrer"
                style={{ fontSize: 12, color: '#2563eb', textDecoration: 'none' }}>
                공시 보기 →
              </a>
            </div>

            {/* 타임라인 */}
            <div>
              <TimelineRow label="반대의사 통지" start={item.dissentNoticeStartDate} end={item.dissentNoticeEndDate} today={today} />
              <TimelineRow label="주식매수청구권" start={item.appraisalRightStartDate} end={item.appraisalRightEndDate} today={today} />
              <TimelineRow label="매매거래 정지" start={item.tradingHaltStartDate} end={item.tradingHaltEndDate} today={today} />
            </div>

            {/* 신주 상장일 */}
            <div style={{ marginTop: 12, padding: '8px 12px', background: '#f0fdf4', borderRadius: 8,
              display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 14 }}>📅</span>
              <span style={{ fontSize: 13, color: '#166534' }}>
                신주 상장 예정일: <strong>{item.newShareListingDate}</strong>
                {today <= item.newShareListingDate && (
                  <span style={{ marginLeft: 8, color: '#6b7280' }}>
                    (D-{Math.ceil((new Date(item.newShareListingDate).getTime() - new Date(today).getTime()) / 86400000)})
                  </span>
                )}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
