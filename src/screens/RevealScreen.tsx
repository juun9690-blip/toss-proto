import type { Dispatch, State } from '../App'
import { effectiveImportance } from '../App'

export default function RevealScreen({ state, dispatch }: { state: State; dispatch: Dispatch }) {
  const p = state.selected
  if (!p) return null
  const isRoom = p.action === 'moveRoomBooking'
  const who = state.attendees.find((a) => a.id === p.whoId)?.name ?? p.whoId
  const imp = effectiveImportance(state)
  const slotText = `${p.slot.day} ${p.slot.hour}:00`
  const resultRoom = isRoom ? p.roomName : state.draft.location

  let targetSuffix = ' 님에게'
  let actionLine = ''
  if (p.action === 'moveFlex') {
    actionLine = '스케줄 조정을 요청해 볼까요?'
  } else if (p.action === 'concedeSoft') {
    actionLine = '참석 가능 여부를 물어볼까요?'
  } else if (isRoom) {
    targetSuffix = '에'
    actionLine = '회의실 사용을 요청해 볼까요?'
  } else {
    targetSuffix = ' 님 없이'
    actionLine = '회의를 진행해 볼까요?'
  }

  return (
    <div className="flow-screen">
      <div className="flow-content stack">
      <div className="adjustment-header">
        <h1>
          <span className="quoted-name">"{who}"</span>{targetSuffix}
          <br />
          {actionLine}
        </h1>
      </div>

      <div className="adjustment-card">
        <div className="impact">
          <span>{slotText} · {resultRoom}에 모두 참석 가능</span>
          <strong>회의 중요도 {imp.level}</strong>
        </div>
      </div>

      <label className="request-message-field">
        요청 메시지
        <textarea
          value={state.requestMessage}
          maxLength={160}
          onChange={(e) => dispatch({ type: 'SET_REQUEST_MESSAGE', message: e.target.value })}
          placeholder="상대방에게 보낼 메시지를 입력해주세요"
        />
        <span>{state.requestMessage.length}/160</span>
      </label>

      </div>

      <div className="flow-cta stack">
        <button className="primary btn-lg btn-block" onClick={() => dispatch({ type: 'SEND_REQUEST' })}>
          {isRoom ? `${who}에 요청 보내기` : `${who} 님에게 요청 보내기`}
        </button>
        <button className="ghost btn-block" onClick={() => dispatch({ type: 'GOTO', screen: 'CANDIDATES' })}>
          ← 다른 조정안 보기
        </button>
      </div>
    </div>
  )
}
