import { useEffect, useState } from 'react'
import type { Dispatch, State } from '../App'
import { effectiveImportance, requiredCount } from '../App'
import { rankMoveTargets, roomEvents, sameSlot } from '../logic/scheduling'
import type { Slot } from '../types'

export default function RespondScreen({ state, dispatch }: { state: State; dispatch: Dispatch }) {
  const [importanceOpen, setImportanceOpen] = useState(false)
  const [messageOpen, setMessageOpen] = useState(false)
  const [showAllMoveTargets, setShowAllMoveTargets] = useState(false)
  // 이동 후보 목록도 '계산되는 것처럼'(labor illusion) — 앞 화면의 계산 배너와 같은 마이크로 인터랙션.
  const [calcStep, setCalcStep] = useState(0)
  const [calcDone, setCalcDone] = useState(false)
  const pel = state.selected
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { setCalcDone(true); return }
    setCalcStep(0); setCalcDone(false)
    const t1 = window.setTimeout(() => setCalcStep(1), 520)
    const t2 = window.setTimeout(() => setCalcDone(true), 1120)
    return () => { window.clearTimeout(t1); window.clearTimeout(t2) }
  }, [pel?.movedEventId, pel?.slot.day, pel?.slot.hour])
  const p = state.selected
  if (!p) return null
  const isRoom = p.action === 'moveRoomBooking'
  const importance = effectiveImportance(state)
  const slotText = `${p.slot.day} ${p.slot.hour}:00`

  // 사람 일정 이동(moveFlex)과 회의실 예약 이동(moveRoomBooking)은 '옮길 자리를 직접 고르는' 같은 흐름.
  // 회의실은 그 방의 예약들을 이벤트로 넘겨 rankMoveTargets를 그대로 재사용한다(요청받는 팀의 재계산 대행).
  const room = isRoom ? state.rooms.find((r) => r.name === p.roomName) : undefined
  const roomBookingEvents = room ? roomEvents(room) : []
  const movedEv = p.action === 'moveFlex'
    ? state.events.find((e) => e.id === p.movedEventId)
    : isRoom ? roomBookingEvents.find((e) => e.id === p.movedEventId) : undefined
  const moveEvents = p.action === 'moveFlex' ? state.events : roomBookingEvents
  const isMove = (p.action === 'moveFlex' || isRoom) && !!movedEv

  let ask = ''
  let requestType = ''
  if (p.action === 'moveFlex') {
    requestType = '일정 이동 요청'
    ask = `'${state.draft.title}' 때문에 '${movedEv?.title}'을 옮겨주실 수 있을까요?`
  } else if (p.action === 'concedeSoft') {
    requestType = '참석 여부 확인'
    ask = `'${state.draft.title}'를 ${slotText}에 함께 하실 수 있을까요?`
  } else if (isRoom) {
    requestType = '회의실 예약 조정 요청'
    ask = `'${state.draft.title}' 때문에 ${slotText}에 ${p.roomName}이 필요해요. 예약을 다른 시간으로 옮겨주실 수 있을까요?`
  } else {
    requestType = '선택 참석 확인'
    ask = `이번 '${state.draft.title}'(${slotText})는 선택 참석이에요. 빠지셔도 괜찮을까요?`
  }

  // 수신자가 '자기 일정/예약'을 옮길 목적지를 직접 고른다 (재계산 대행 + 통제감)
  const sel: Slot | null = state.receiverMoveTo
  // 옮길 일정의 길이 — 후보 칸 크기·시간 표기로 그대로 드러난다(회의실 예약은 1시간).
  const moveSpan = movedEv ? Math.max(1, movedEv.endHour - movedEv.startHour) : 1
  const moveTargets = isMove && movedEv ? rankMoveTargets(movedEv, moveEvents, p.slot) : []
  // 1+N 위계 — 1위는 히어로 카드, 2위부터 컴팩트 행. 히어로 1 + 컴팩트 3(펼치면 나머지 전부).
  const hero = moveTargets[0] ?? null
  const restTargets = moveTargets.slice(1)
  const visibleRest = showAllMoveTargets ? restTargets : restTargets.slice(0, 3)
  const moreCount = restTargets.length - visibleRest.length
  const timeLabel = (s: Slot) => `${s.day} ${s.hour}:00${moveSpan > 1 ? `–${s.hour + moveSpan}:00` : ''}`
  const acceptDisabled = isMove && !state.receiverMoveTo
  const calcStatus = calcStep === 0 ? '옮길 수 있는 시간을 모으고 있어요' : '조정 부담이 적은 순서로 맞추고 있어요'

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
              {importance.overridden
                ? <>주최자가 직접 '{importance.level}'으로 설정했어요.{importance.level !== importance.auto && <> (자동 계산은 '{importance.auto}')</>}</>
                : <>꼭 참석 {requiredCount(state.attendees)}명 기준으로 자동 계산했어요.</>}
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
            <div className="move-picker move-cost-picker">
              {moveTargets.length === 0 ? (
                <>
                  <div className="move-picker-head">
                    <b>스케줄 조정 부담이 적은 순서예요</b>
                  </div>
                  <p className="move-target-empty">이번 주에는 이 일정을 그대로 옮길 빈 시간이 없어요.</p>
                </>
              ) : !calcDone ? (
                // 계산 배너 — 앞 화면(CandidatesScreen)과 같은 '…' 마이크로 인터랙션
                <div className="rec-computing" aria-live="polite">
                  <span className="rec-computing-dots" aria-hidden="true"><i /><i /><i /></span>
                  <span className="rec-computing-text" key={calcStep}>{calcStatus}</span>
                </div>
              ) : (
                <>
                  <div className="move-picker-head">
                    <b>스케줄 조정 부담이 적은 순서예요</b>
                  </div>
                  {/* 1위 = 히어로 카드(넓게) — 크기·밀도 대비로 '1순위가 추천'임을 말한다 */}
                  {hero && (() => {
                    const on = sel ? sameSlot(hero.slot, sel) : false
                    return (
                      <button
                        className={`move-target-hero ${on ? 'on' : ''}`}
                        onClick={() => dispatch({ type: 'PICK_MOVE_DEST', slot: hero.slot })}
                      >
                        <div className="move-hero-top">
                          <span className="move-hero-time">{timeLabel(hero.slot)}</span>
                          <span className="move-hero-badge">{hero.badgeLabel}</span>
                        </div>
                      </button>
                    )
                  })()}
                  {/* 2위~ = 컴팩트 행(조밀하게) */}
                  {visibleRest.length > 0 && (
                    <div className="move-target-list" aria-label="다른 이동 후보">
                      {visibleRest.map((target, i) => {
                        const on = sel ? sameSlot(target.slot, sel) : false
                        return (
                          <button
                            key={`${target.slot.day}-${target.slot.hour}`}
                            className={`move-target ${on ? 'on' : ''}`}
                            style={{ animationDelay: `${(i + 1) * 45 + 120}ms` }}
                            onClick={() => dispatch({ type: 'PICK_MOVE_DEST', slot: target.slot })}
                          >
                            <span className="move-target-time">{timeLabel(target.slot)}</span>
                            <span className="move-target-reason">{target.badgeLabel}</span>
                          </button>
                        )
                      })}
                    </div>
                  )}
                  {(moreCount > 0 || showAllMoveTargets) && restTargets.length > 3 && (
                    <button className="move-target-more" onClick={() => setShowAllMoveTargets((open) => !open)}>
                      {showAllMoveTargets ? '적게 보기' : `다른 빈 시간 ${moreCount}개 보기`}
                    </button>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </div>

      <div className="flow-cta action-row respond-action-row">
        <button className="ghost btn-lg" onClick={() => dispatch({ type: 'PROPOSE_ALT' })}>
          다른 시간이 좋아요
        </button>
        <button className="primary btn-lg" disabled={acceptDisabled} onClick={() => dispatch({ type: 'ACCEPT' })}>
          {isMove ? '옮기고 수락하기' : '수락하기'}
        </button>
      </div>
    </div>
  )
}
