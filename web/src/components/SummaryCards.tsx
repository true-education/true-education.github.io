type Filter = 'ALL' | 'NORMAL' | 'MERGE_REVIEW' | 'MERGE_APPROVED'

interface Props {
  counts: { total: number; normal: number; review: number; approved: number }
  onFilter: (f: Filter) => void
  activeFilter: Filter
}

const cards = [
  { key: 'ALL' as Filter,           label: '전체',       emoji: '📋', bg: '#f8fafc', border: '#e2e8f0', text: '#1e293b' },
  { key: 'NORMAL' as Filter,        label: '일반',       emoji: '🟢', bg: '#f0fdf4', border: '#86efac', text: '#166534' },
  { key: 'MERGE_REVIEW' as Filter,  label: '합병 심사',  emoji: '🟡', bg: '#fefce8', border: '#fde047', text: '#854d0e' },
  { key: 'MERGE_APPROVED' as Filter,label: '합병 승인',  emoji: '🔵', bg: '#eff6ff', border: '#93c5fd', text: '#1e40af' },
]

export default function SummaryCards({ counts, onFilter, activeFilter }: Props) {
  const values = { ALL: counts.total, NORMAL: counts.normal, MERGE_REVIEW: counts.review, MERGE_APPROVED: counts.approved }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
      {cards.map(c => (
        <button
          key={c.key}
          onClick={() => onFilter(c.key)}
          style={{
            padding: '16px',
            borderRadius: 10,
            border: `2px solid ${activeFilter === c.key ? c.border : '#e5e7eb'}`,
            background: activeFilter === c.key ? c.bg : '#fff',
            cursor: 'pointer',
            textAlign: 'left',
            transition: 'all 0.15s',
          }}
        >
          <div style={{ fontSize: 22, marginBottom: 4 }}>{c.emoji}</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: c.text }}>{values[c.key]}</div>
          <div style={{ fontSize: 13, color: '#888' }}>{c.label}</div>
        </button>
      ))}
    </div>
  )
}
