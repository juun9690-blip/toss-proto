import type { Screen } from '../types'

const STEPS: { key: Screen; label: string }[] = [
  { key: 'CREATE', label: '1 회의 정보' },
  { key: 'ATTENDEES', label: '2 참석자' },
  { key: 'CANDIDATES', label: '3 시간 확인' },
  { key: 'REVEAL', label: '4 근거 확인' },
  { key: 'RESPOND', label: '5 요청 응답' },
  { key: 'CONFIRM', label: '6 확정' },
]

export default function StepBar({ screen }: { screen: Screen }) {
  const order = STEPS.map((s) => s.key)
  const curIdx = order.indexOf(screen === 'SETUP' ? 'CREATE' : screen === 'REQUESTING' ? 'RESPOND' : screen)
  return (
    <div className="steps">
      {STEPS.map((s, i) => {
        const cls = i === curIdx ? 'active' : i < curIdx ? 'done' : ''
        return <span key={s.key} className={`step ${cls}`}>{s.label}</span>
      })}
    </div>
  )
}
