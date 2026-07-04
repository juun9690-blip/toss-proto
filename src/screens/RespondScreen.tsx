import { useState } from 'react'
import type { Dispatch, State } from '../App'
import { effectiveImportance } from '../App'

export default function RespondScreen({ state, dispatch }: { state: State; dispatch: Dispatch }) {
  const [importanceOpen, setImportanceOpen] = useState(false)
  const p = state.selected
  if (!p) return null
  const isRoom = p.action === 'moveRoomBooking'
  const who = state.attendees.find((a) => a.id === p.whoId)?.name ?? p.whoId
  const importance = effectiveImportance(state)
  const slotText = `${p.slot.day} ${p.slot.hour}:00`

  let ask = ''
  let requestType = ''
  if (p.action === 'moveFlex' && p.moveTo) {
    const ev = state.events.find((e) => e.id === p.movedEventId)
    requestType = '일정 이동 요청'
    ask = `'${state.draft.title}' 때문에 '${ev?.title}'을 ${p.moveTo.day} ${p.moveTo.hour}:00로 옮겨도 될까요?`
  } else if (p.action === 'concedeSoft') {
    requestType = '참석 가능 여부 확인'
    ask = `'${state.draft.title}'를 ${slotText}에 함께 하실 수 있을까요?`
  } else if (isRoom && p.moveTo) {
    requestType = '회의실 사용 확인'
    ask = `'${state.draft.title}' 때문에 ${slotText}에 ${p.roomName}을 사용할 수 있을지 확인 부탁드려도 될까요?`
  } else {
    requestType = '선택 참석 확인'
    ask = `이번 '${state.draft.title}'(${slotText})는 선택 참석이에요. 빠지셔도 괜찮을까요?`
  }

  return (
    <div className="flow-screen">
      <div className="flow-content stack">
      <div className="request-summary">
        <h1>{requestType}</h1>
        <p>{ask}</p>
        <button className={`importance-toggle ${importanceOpen ? 'open' : ''}`} onClick={() => setImportanceOpen((open) => !open)}>
          <span>회의 중요도 {importance.level}</span>
          <em aria-hidden="true" />
        </button>
        {importanceOpen && (
          <div className="importance-detail">
            {importance.reason} 기준으로 중요도를 판단했어요.
          </div>
        )}
      </div>

      {state.requestMessage.trim() && (
        <div className="host-message">
          <span>주최자 메시지</span>
          <p>{state.requestMessage}</p>
        </div>
      )}

      </div>

      <div className="flow-cta">
        <div className="response-actions">
          <button className="ghost btn-lg" onClick={() => dispatch({ type: 'PROPOSE_ALT' })}>다른 시간이 좋아요</button>
          <button className="primary btn-lg" onClick={() => dispatch({ type: 'ACCEPT' })}>수락</button>
        </div>
        <p className="note">지금이 어려우면 '다른 시간이 좋아요'를 눌러요. 주최자가 다른 시간을 이어서 찾아줘요.</p>
      </div>
    </div>
  )
}
