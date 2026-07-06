import { useEffect, useRef } from 'react'
import type { Dispatch, State } from '../App'
import { effectiveImportance } from '../App'
import { TEAM_TITLES } from '../data/mock'
import { LEVELS } from '../types'

export default function AttendeesScreen({ state, dispatch }: { state: State; dispatch: Dispatch }) {
  const { attendees } = state
  const imp = effectiveImportance(state)
  const selectedRequiredCount = attendees.filter((a) => a.role === 'required').length
  const selectedAttendeeCount = attendees.filter((a) => a.role !== 'optional').length
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
        </section>

        {/* 중요도 — 필참 인원수에 반응 + 직접 설정 */}
        <section className="form-section">
          <div className="spread">
            <h2 style={{ margin: 0 }}>회의 중요도</h2>
            <span className={`badge ${imp.level === '높음' ? 'hero' : ''}`}>{imp.level}</span>
          </div>
          <div className="seg">
            <button className={!state.importanceOverride ? 'active' : ''} onClick={() => dispatch({ type: 'SET_IMPORTANCE', level: null })}>자동</button>
            {LEVELS.map((lv) => (
              <button key={lv} className={state.importanceOverride === lv ? 'active' : ''} onClick={() => dispatch({ type: 'SET_IMPORTANCE', level: lv })}>{lv}</button>
            ))}
          </div>
          <p className="note">자동 추정은 <b>{imp.auto}</b>이에요. {estimateReason(state)} 기준으로 계산했어요.</p>
        </section>
      </div>

      <div className="flow-cta action-row">
        <button className="ghost btn-lg" onClick={() => dispatch({ type: 'GOTO', screen: 'CREATE' })}>뒤로</button>
        <button className="primary btn-lg" disabled={selectedRequiredCount === 0} onClick={() => dispatch({ type: 'COMPUTE' })}>가능한 시간 보기</button>
      </div>
    </div>
  )
}

function avatarText(name: string): string {
  return name === '나' ? '나' : name.slice(0, 1)
}

function estimateReason(state: State): string {
  const req = state.attendees.filter((a) => a.role !== 'optional').length
  const hit = ['결정', '승인', '전사', '분기', '의사결정', '전략'].find((k) => state.draft.agenda.includes(k))
  return `꼭 참석 ${req}명${hit ? ` · '${hit}' 안건` : ''}`
}
