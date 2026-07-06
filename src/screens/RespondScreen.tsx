import { useState } from 'react'
import type { Dispatch, State } from '../App'
import { effectiveImportance } from '../App'
import { moveTargets, sameSlot } from '../logic/scheduling'
import type { Slot } from '../types'

export default function RespondScreen({ state, dispatch }: { state: State; dispatch: Dispatch }) {
  const [importanceOpen, setImportanceOpen] = useState(false)
  const [messageOpen, setMessageOpen] = useState(false)
  const p = state.selected
  if (!p) return null
  const isRoom = p.action === 'moveRoomBooking'
  const importance = effectiveImportance(state)
  const slotText = `${p.slot.day} ${p.slot.hour}:00`

  const isMove = p.action === 'moveFlex'
  const movedEv = isMove ? state.events.find((e) => e.id === p.movedEventId) : undefined

  let ask = ''
  let requestType = ''
  if (p.action === 'moveFlex') {
    requestType = '일정 이동 요청'
    ask = `'${state.draft.title}' 때문에 '${movedEv?.title}'을 옮겨주실 수 있을까요?`
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

  // moveFlex 응답: 수신자가 '자기 일정'을 옮길 목적지를 직접 고른다 (재계산 대행 + 통제감)
  const sel: Slot | null = state.receiverMoveTo ?? p.moveTo ?? null
  const chips: Slot[] = []
  if (isMove && movedEv) {
    const push = (s?: Slot | null) => { if (s && !chips.some((c) => sameSlot(c, s))) chips.push(s) }
    push(p.moveTo) // 시스템 추천 먼저
    moveTargets(movedEv, state.events, p.slot).forEach(push)
  }
  const chipList = chips.slice(0, 5)
  const selText = sel ? `${sel.day} ${sel.hour}:00` : ''

  return (
    <div className="flow-screen">
      <div className="flow-content stack">
        <div className="request-summary">
          <h1>{requestType}</h1>
          <p>{ask}</p>
          <div className={`request-insight-row ${state.requestMessage.trim() ? 'pair' : ''}`}>
            <button className={`importance-toggle ${importanceOpen ? 'open' : ''}`} onClick={() => setImportanceOpen((open) => !open)}>
              <span>회의 중요도</span>
              <strong>{importance.level}</strong>
              <em aria-hidden="true" />
            </button>
            {state.requestMessage.trim() && (
              <button className={`importance-toggle message-toggle ${messageOpen ? 'open' : ''}`} onClick={() => setMessageOpen((open) => !open)}>
                <span>주최자 메시지</span>
                <em aria-hidden="true" />
              </button>
            )}
          </div>
          {importanceOpen && (
            <div className="importance-detail">
              {importance.reason} 기준으로 중요도를 판단했어요.
            </div>
          )}
          {messageOpen && (
            <div className="host-message-detail">
              {state.requestMessage}
            </div>
          )}
        </div>

        {isMove && movedEv && (
          <>
            <div className="request-section-divider" aria-hidden="true" />
            <div className="move-picker">
              <div className="move-picker-head">
                <b>'{movedEv.title}' 어디로 옮길까요?</b>
                <span>겹치는 일정을 대신 계산해 <strong>비는 시간</strong>을 찾아뒀어요 — 원하는 곳으로 고르면 돼요.</span>
              </div>
              <div className="move-chips">
                {chipList.map((s, i) => {
                  const on = sel ? sameSlot(s, sel) : false
                  const rec = p.moveTo ? sameSlot(s, p.moveTo) : false
                  return (
                    <button
                      key={`${s.day}-${s.hour}`}
                      className={`move-chip ${on ? 'on' : ''}`}
                      style={{ animationDelay: `${i * 45}ms` }}
                      onClick={() => dispatch({ type: 'PICK_MOVE_DEST', slot: s })}
                    >
                      {s.day} {s.hour}:00{rec && <em>추천</em>}
                    </button>
                  )
                })}
              </div>
            </div>
          </>
        )}
      </div>

      <div className="flow-cta">
        <div className="response-actions">
          <button className="ghost btn-lg" onClick={() => dispatch({ type: 'PROPOSE_ALT' })}>다른 시간이 좋아요</button>
          <button className="primary btn-lg" onClick={() => dispatch({ type: 'ACCEPT' })}>
            {isMove && selText ? `${selText}로 옮기고 수락` : '수락'}
          </button>
        </div>
      </div>
    </div>
  )
}
