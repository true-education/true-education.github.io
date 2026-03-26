import type { SpacItem } from '../types'

interface Props {
  item: SpacItem
  onClose: () => void
}

interface StepResult {
  year: number
  rate: number
  principal: number
  interest: number
  tax: number
  fee: number
  result: number
  remainingDays?: number
}

function calcSteps(item: SpacItem): StepResult[] {
  const INCOME_TAX = 0.154
  const TRUST_FEE  = 0.001
  const steps: StepResult[] = []
  let p = 2000.0

  // 1년차
  const i1 = p * item.rate1
  const t1 = i1 * INCOME_TAX
  const f1 = p * TRUST_FEE
  const r1 = p + i1 - t1 - f1
  steps.push({ year: 1, rate: item.rate1, principal: p, interest: i1, tax: t1, fee: f1, result: r1 })
  p = r1

  // 2년차
  const i2 = p * item.rate2
  const t2 = i2 * INCOME_TAX
  const f2 = p * TRUST_FEE
  const r2 = p + i2 - t2 - f2
  steps.push({ year: 2, rate: item.rate2, principal: p, interest: i2, tax: t2, fee: f2, result: r2 })
  p = r2

  // 3년차 일할
  const listing = new Date(item.listingDate).getTime()
  const expire  = new Date(item.expireDate).getTime()
  const totalDays = (expire - listing) / (1000 * 60 * 60 * 24)
  const remainingDays = Math.round(totalDays - 730)
  const ratio = remainingDays / 365.0
  const i3 = p * item.rate3 * ratio
  const t3 = i3 * INCOME_TAX
  const f3 = p * TRUST_FEE * ratio
  const r3 = p + i3 - t3 - f3
  steps.push({ year: 3, rate: item.rate3, principal: p, interest: i3, tax: t3, fee: f3, result: r3, remainingDays: remainingDays })
  p = r3

  return steps
}

const fmt = (n: number) => n.toFixed(2)
const fmtW = (n: number) => Math.round(n).toLocaleString() + '원'

export default function RedemptionPopup({ item, onClose }: Props) {
  const steps = calcSteps(item)
  const final = steps[steps.length - 1].result

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ background: '#fff', borderRadius: 12, padding: 24, width: 420,
          maxWidth: '95vw', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}
      >
        {/* 헤더 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>{item.name}</div>
            <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 2 }}>예상 청산가 계산</div>
          </div>
          <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer',
            fontSize: 20, color: '#9ca3af', lineHeight: 1 }}>×</button>
        </div>

        {/* 공모가 */}
        <div style={{ background: '#f8fafc', borderRadius: 8, padding: '8px 12px', marginBottom: 12,
          fontSize: 13, display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: '#6b7280' }}>공모가 (원금)</span>
          <span style={{ fontWeight: 600 }}>2,000원</span>
        </div>

        {/* 각 년차 계산 */}
        {steps.map(s => (
          <div key={s.year} style={{ border: '1px solid #e5e7eb', borderRadius: 8,
            padding: '10px 12px', marginBottom: 10, fontSize: 13 }}>
            <div style={{ fontWeight: 600, color: '#2563eb', marginBottom: 6 }}>
              {s.year}년차 ({(s.rate * 100).toFixed(2)}%{s.remainingDays ? ` × ${s.remainingDays}일/365일` : ''})
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '3px 8px', color: '#6b7280' }}>
              <span>원금</span><span style={{ textAlign: 'right' }}>{fmtW(s.principal)}</span>
              <span>이자</span><span style={{ textAlign: 'right', color: '#059669' }}>+{fmtW(s.interest)}</span>
              <span>이자소득세 (15.4%)</span><span style={{ textAlign: 'right', color: '#dc2626' }}>-{fmtW(s.tax)}</span>
              <span>신탁수수료 (0.1%)</span><span style={{ textAlign: 'right', color: '#dc2626' }}>-{fmtW(s.fee)}</span>
              <span style={{ borderTop: '1px solid #e5e7eb', paddingTop: 4, fontWeight: 600, color: '#1e293b' }}>
                소계
              </span>
              <span style={{ borderTop: '1px solid #e5e7eb', paddingTop: 4, textAlign: 'right',
                fontWeight: 600, color: '#1e293b' }}>{fmtW(s.result)}</span>
            </div>
          </div>
        ))}

        {/* 최종 결과 */}
        <div style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 8,
          padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 13, color: '#166534', fontWeight: 600 }}>예상 청산가</div>
            <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
              수익률 {fmt((final - 2000) / 2000 * 100)}% (공모가 대비)
            </div>
          </div>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#059669' }}>
            {Math.round(final).toLocaleString()}원
          </div>
        </div>

        <div style={{ marginTop: 10, fontSize: 11, color: '#9ca3af', textAlign: 'center' }}>
          ※ 실제 청산가는 오차가 발생할 수 있습니다. 증권사에서 확인하세요.
        </div>
      </div>
    </div>
  )
}
