import { useEffect, useRef } from 'react'
import type { Dispatch, State } from '../App'
import { TEAM_TITLES } from '../data/mock'

export default function SetupScreen({ state, dispatch }: { state: State; dispatch: Dispatch }) {
  const { attendees } = state
  const selectedRequiredCount = attendees.filter((a) => a.role === 'required').length
  const selectedAttendeeCount = attendees.filter((a) => a.role !== 'optional').length
  const hasPicked = selectedRequiredCount > 0
  // 인원수 롤업 방향 추적 (ATTENDEES와 동일 문법)
  const prevCount = useRef(selectedAttendeeCount)
  const countDir = selectedAttendeeCount >= prevCount.current ? 'up' : 'down'
  useEffect(() => {
    prevCount.current = selectedAttendeeCount
  }, [selectedAttendeeCount])

  const ctaText = hasPicked
    ? `꼭 참석 ${selectedAttendeeCount}명과 회의 잡기`
    : state.selectedSlot
      ? `${state.selectedSlot.day} ${state.selectedSlot.hour}:00에 회의 잡기`
      : '우리 팀 회의 잡기'

  return (
    <div className="flow-screen">
      <div className="flow-content stack setup-content">
        <div>
          <div className="setup-team-title">
            {hasPicked ? (
              <>
                <span className={`count-roll ${countDir}`} key={selectedAttendeeCount}>{selectedAttendeeCount}</span>명이 꼭 참석해요
              </>
            ) : '우리 팀이에요'}
          </div>
          <div className="note setup-team-sub">
            {hasPicked ? '더 눌러서 참석자를 조절할 수 있어요' : '눌러서 꼭 참석할 사람을 정해보세요'}
          </div>
        </div>

        {/* 팀원 행 = 참석자 지정 버튼 (ATTENDEES와 같은 attendee-select-row 문법) */}
        <div className="attendee-list">
          {attendees.map((a) => {
            const row = (
              <>
                <div className="avatar">{avatarText(a.name)}</div>
                <div className="profile-copy">
                  <div className="profile-name">
                    <span>{a.name}</span>
                  </div>
                  <div className="profile-meta">{TEAM_TITLES[a.id] ?? '팀 메이트'}</div>
                </div>
                <div className="profile-action">
                  <span className={`role-pill ${a.role === 'host' ? 'host' : a.role === 'required' ? 'required' : ''}`}>
                    {a.role === 'host' ? '주최자' : a.role === 'required' ? '꼭 참석' : '선택 참석'}
                  </span>
                </div>
              </>
            )
            return a.role === 'host' ? (
              <div key={a.id} className="profile-row compact attendee-select-row host-row">
                {row}
              </div>
            ) : (
              <button
                key={a.id}
                type="button"
                className={`profile-row compact attendee-select-row ${a.role === 'required' ? 'selected' : ''}`}
                aria-pressed={a.role === 'required'}
                onClick={() => dispatch({ type: 'TOGGLE_ROLE', id: a.id })}
              >
                {row}
              </button>
            )
          })}
        </div>
      </div>

      <div className="flow-cta">
        <button className="primary btn-lg btn-block" onClick={() => dispatch({ type: 'GOTO', screen: 'CREATE' })}>
          {ctaText}
        </button>
      </div>
    </div>
  )
}

function avatarText(name: string): string {
  return name === '나' ? '나' : name.slice(0, 1)
}
