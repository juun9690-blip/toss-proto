import { useEffect, useRef } from 'react'
import type { Dispatch, State } from '../App'
import { effectiveImportance } from '../App'
import { TEAM_TITLES } from '../data/mock'
import { LEVELS } from '../types'
import ProfileAvatar from '../components/ProfileAvatar'

export default function AttendeesScreen({ state, dispatch }: { state: State; dispatch: Dispatch }) {
  const { attendees } = state
  const imp = effectiveImportance(state)
  const selectedRequiredCount = attendees.filter((a) => a.role === 'required').length
  const selectedAttendeeCount = attendees.filter((a) => a.role !== 'optional').length
  // 순차 공개 — 첫 필참을 지정해야 중요도 섹션 등장(자동 추정이 그때부터 유효). 한 번 나오면 유지.
  const importanceLatch = useRef(false)
  importanceLatch.current = importanceLatch.current || selectedRequiredCount > 0
  // 인원수가 바뀌면 숫자가 위/아래로 굴러 들어오게 — 방향(늘었나 줄었나) 추적
  const prevCount = useRef(selectedAttendeeCount)
  const countDir = selectedAttendeeCount >= prevCount.current ? 'up' : 'down'
  useEffect(() => {
    prevCount.current = selectedAttendeeCount
  }, [selectedAttendeeCount])

  return (
    <div className="flow-screen">
      <div className="flow-content stack create-form">
        <div className="create-intro">
          <h1 className="attendees-title">
            {selectedRequiredCount > 0 ? (
              <>
                <span><span className={`count-roll ${countDir}`} key={selectedAttendeeCount}>{selectedAttendeeCount}</span>명</span>이 꼭 참석하는 회의
              </>
            ) : '누가 모이나요?'}
          </h1>
        </div>

        {/* 우리 팀 — 필참/선택 선택 */}
        <section className="form-section attendee-list">
          {attendees.map((a) => {
            const row = (
              <>
                <ProfileAvatar id={a.id} />
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
        </section>

        {/* 중요도 — 첫 필참 지정 후 등장(순차 공개), 필참 인원수에 자동 반응 */}
        {importanceLatch.current && (
        <section className="form-section reveal-section">
          <h2 className={`importance-summary ${imp.overridden ? 'manual' : 'auto'}`}>
            <span>회의 중요도</span>
            <strong key={`${imp.overridden ? 'manual' : 'auto'}-${imp.level}-${selectedAttendeeCount}`}>{imp.level}</strong>
            {!imp.overridden && <small key={`${imp.level}-${selectedAttendeeCount}`}>꼭 참석 {selectedAttendeeCount}명 기준</small>}
          </h2>
          <div className="seg">
            <button className={!state.importanceOverride ? 'active' : ''} onClick={() => dispatch({ type: 'SET_IMPORTANCE', level: null })}>자동</button>
            {LEVELS.map((lv) => (
              <button key={lv} className={state.importanceOverride === lv ? 'active' : ''} onClick={() => dispatch({ type: 'SET_IMPORTANCE', level: lv })}>{lv}</button>
            ))}
          </div>
        </section>
        )}
      </div>

      <div className="flow-cta action-row">
        <button className="ghost btn-lg" onClick={() => dispatch({ type: 'GOTO', screen: 'CREATE' })}>← 뒤로</button>
        <button className={`primary btn-lg ${selectedRequiredCount > 0 ? 'cta-ready' : ''}`} disabled={selectedRequiredCount === 0} onClick={() => dispatch({ type: 'COMPUTE' })}>가능한 시간 보기</button>
      </div>
    </div>
  )
}
