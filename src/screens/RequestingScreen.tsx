import { useEffect, useState } from 'react'
import type { State } from '../App'

export default function RequestingScreen({ state }: { state: State }) {
  const p = state.selected
  const isRoom = p?.action === 'moveRoomBooking'
  const who = p ? (isRoom ? p.whoId : state.attendees.find((a) => a.id === p.whoId)?.name) : ''
  const target = isRoom ? `${who}에` : `${who} 님께`
  // 전송 중(dot loader) → 전송 완료(체크). App이 1300ms 뒤 RESPOND로 전환한다.
  const [phase, setPhase] = useState<'sending' | 'sent'>('sending')
  useEffect(() => {
    const t = window.setTimeout(() => setPhase('sent'), 600)
    return () => window.clearTimeout(t)
  }, [])

  return (
    <div className="handoff">
      {phase === 'sending' ? (
        <>
          <div className="handoff-dots" aria-hidden="true"><span /><span /><span /></div>
          <h1>{target} 요청을 보내는 중</h1>
          <p className="screen-desc">잠시만요, 정중하게 전달하고 있어요.</p>
        </>
      ) : (
        <>
          <div className="handoff-mark sent">✓</div>
          <h1>{target} 요청을 보냈어요</h1>
          <p className="screen-desc">이제 {isRoom ? who : `${who} 님`}이 보는 화면으로 전환됩니다.</p>
        </>
      )}
    </div>
  )
}
