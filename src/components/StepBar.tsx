import type { Screen } from '../types'

const STEPS: { key: Screen; label: string }[] = [
  { key: 'CREATE', label: '1 회의 정보' },
  { key: 'ATTENDEES', label: '2 참석자' },
  { key: 'CANDIDATES', label: '3 시간 확인' },
  { key: 'REVEAL', label: '4 요청 확인' },
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
        // 활성(파란) 단계로 바뀔 때 key가 달라져 리마운트 → pop/glow 애니메이션이 재생된다.
        return <span key={s.key + (i === curIdx ? '-on' : '')} className={`step ${cls}`}>{s.label}</span>
      })}
    </div>
  )
}
