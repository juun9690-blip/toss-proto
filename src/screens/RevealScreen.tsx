import type { Dispatch, State } from '../App'
import { requiredCount } from '../App'
import { sameSlot, moveTargets, eventsForScheduling, type SlotCost } from '../logic/scheduling'

export default function RevealScreen({
  state,
  dispatch,
  best,
}: {
  state: State
  dispatch: Dispatch
  best: SlotCost | null
}) {
  const p = state.selected
  if (!p) return null
  const isRoom = p.action === 'moveRoomBooking'
  const who = state.attendees.find((a) => a.id === p.whoId)?.name ?? p.whoId
  const slotText = `${p.slot.day} ${p.slot.hour}:00`
  const resultRoom = isRoom ? p.roomName : state.draft.location
  // 소규모 회의에서 정말 바로 되는 시간이 따로 있을 때만 전환 링크를 보여준다.
  const cheaperNoAsk = best && best.asks === 0 && !sameSlot(best.slot, p.slot)
  const showNoAskJump = cheaperNoAsk && requiredCount(state.attendees) <= 3
  const bestText = best ? `${best.slot.day} ${best.slot.hour}:00` : ''
  const requestTarget = isRoom ? who : `${who} 님`

  // 명분 라인(§3.2) — '일정 평가 언어'만. 옮길 자리가 넉넉할 때(n≥3)만 노출한다.
  // (여지가 적을 때 강조하면 오히려 압박 — n≤2 숨김. "여유/한가" 같은 사람 평가 언어는 가드레일상 금지)
  const movedEv = p.action === 'moveFlex' && p.movedEventId ? state.events.find((e) => e.id === p.movedEventId) : null
  const moveHeadroom = movedEv ? moveTargets(movedEv, eventsForScheduling(state.attendees, state.events), p.slot).length : 0
  const showHeadroom = p.action === 'moveFlex' && moveHeadroom >= 3

  let targetSuffix = ' 님에게'
  let actionLine = ''
  if (p.action === 'moveFlex') {
    actionLine = '일정 이동을 요청해 볼까요?'
  } else if (p.action === 'concedeSoft') {
    actionLine = '참석 여부를 물어볼까요?'
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
            <span className="quoted-name" key={who}>"{who}"</span>{targetSuffix}
            <br />
            {actionLine}
          </h1>
        </div>

        <div className="adjustment-card">
          <p className="adjustment-result-line">{slotText} · {resultRoom}에 모두 참석 가능</p>
          {showHeadroom && (
            <p className="adjustment-rationale-line">옮길 수 있는 자리가 {moveHeadroom}곳 있는 일정이에요</p>
          )}
        </div>

        {showNoAskJump && best && (
          <div className="request-rationale has-perfect-link">
            <button
              type="button"
              onClick={() => {
                dispatch({ type: 'SELECT_SLOT', slot: best.slot })
                dispatch({ type: 'GOTO', screen: 'CANDIDATES' })
              }}
            >
              조정 없이 되는 시간 {bestText}으로 바꿔보기 <span className="soft-chevron right" aria-hidden="true" />
            </button>
          </div>
        )}

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

      <div className="flow-cta action-row">
        <button className="ghost btn-lg" onClick={() => dispatch({ type: 'GOTO', screen: 'CANDIDATES' })}>
          ← 뒤로
        </button>
        <button className="primary btn-lg" onClick={() => dispatch({ type: 'SEND_REQUEST' })}>
          {isRoom ? '요청 보내기' : `${requestTarget}에게 보내기`}
        </button>
      </div>
    </div>
  )
}
