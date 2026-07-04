import type { State } from '../App'

export default function RequestingScreen({ state }: { state: State }) {
  const p = state.selected
  const isRoom = p?.action === 'moveRoomBooking'
  const who = p ? (isRoom ? p.whoId : state.attendees.find((a) => a.id === p.whoId)?.name) : ''
  const target = isRoom ? `${who}에` : `${who} 님께`

  return (
    <div className="handoff">
      <div className="handoff-mark">✓</div>
      <h1>{target} 요청을 보냈습니다</h1>
      <p className="screen-desc">이제 {isRoom ? who : `${who} 님`}이 보는 화면으로 전환됩니다.</p>
    </div>
  )
}
