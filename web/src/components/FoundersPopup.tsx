interface Founder {
  name: string
  shares: number
  pct: number | null
  note: string
}

interface FounderEntry {
  code: string
  nameKr: string
  founders: Founder[]
}

interface Props {
  entry: FounderEntry
  onClose: () => void
}

const NOTE_STYLE: Record<string, { background: string; color: string }> = {
  '투자매매업자': { background: '#dbeafe', color: '#1e40af' },
  '최대주주':     { background: '#f0fdf4', color: '#166534' },
  '발기인':       { background: '#f3f4f6', color: '#374151' },
}

export type { FounderEntry }

export default function FoundersPopup({ entry, onClose }: Props) {
  const totalShares = entry.founders.reduce((s, f) => s + f.shares, 0)

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ background: '#fff', borderRadius: 14, padding: 24, width: 440,
          maxWidth: '95vw', maxHeight: '80vh', overflowY: 'auto',
          boxShadow: '0 24px 64px rgba(0,0,0,0.22)' }}
      >
        {/* 헤더 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>{entry.nameKr}</div>
            <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 2 }}>발기인 현황 (공모 전)</div>
          </div>
          <button onClick={onClose}
            style={{ border: 'none', background: 'none', cursor: 'pointer',
              fontSize: 22, color: '#9ca3af', lineHeight: 1, padding: '0 0 0 8px' }}>×</button>
        </div>

        {/* 발기인 목록 */}
        {entry.founders.length === 0 ? (
          <div style={{ padding: '24px 0', textAlign: 'center', color: '#9ca3af', fontSize: 14 }}>
            발기인 정보가 없습니다
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {entry.founders.map((f, i) => {
              const noteStyle = NOTE_STYLE[f.note] ?? NOTE_STYLE['발기인']
              const pct = f.pct ?? (totalShares > 0 ? f.shares / totalShares * 100 : 0)
              return (
                <div key={i} style={{
                  border: '1px solid #e5e7eb', borderRadius: 10, padding: '10px 14px',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 14, overflow: 'hidden',
                      textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</div>
                    <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                      {f.shares.toLocaleString()}주 &nbsp;·&nbsp; {pct.toFixed(2)}%
                    </div>
                  </div>
                  <span style={{
                    ...noteStyle, padding: '3px 10px', borderRadius: 99,
                    fontSize: 11, fontWeight: 600, flexShrink: 0, whiteSpace: 'nowrap'
                  }}>
                    {f.note || '발기인'}
                  </span>
                </div>
              )
            })}
          </div>
        )}

        {/* 합계 */}
        {entry.founders.length > 0 && (
          <div style={{ marginTop: 14, padding: '8px 14px', background: '#f9fafb',
            borderRadius: 8, display: 'flex', justifyContent: 'space-between',
            fontSize: 13, color: '#6b7280' }}>
            <span>합계</span>
            <span style={{ fontWeight: 600, color: '#1e293b' }}>
              {totalShares.toLocaleString()}주
            </span>
          </div>
        )}

        <div style={{ marginTop: 12, fontSize: 11, color: '#9ca3af', textAlign: 'center' }}>
          ※ IPO 시점 투자설명서 기준 (공모 전)
        </div>
      </div>
    </div>
  )
}
