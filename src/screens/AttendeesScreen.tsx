import type { Dispatch, State } from '../App'
import { effectiveImportance } from '../App'
import { SOFT_PREF_LABEL } from '../data/mock'
import { LEVELS } from '../types'

export default function AttendeesScreen({ state, dispatch }: { state: State; dispatch: Dispatch }) {
  const { attendees } = state
  const imp = effectiveImportance(state)
  const requiredCount = attendees.filter((a) => a.role !== 'optional').length

  return (
    <div className="flow-screen">
      <div className="flow-content stack create-form">
        <div className="create-intro">
          <h1>누가 모이나요?</h1>
        </div>

        {/* 우리 팀 — 필참/선택 선택 */}
        <section className="form-section">
          <div className="team-head" style={{ marginBottom: 2 }}>
            <div className="team-kicker">이번 회의에 필요한 사람</div>
            <span className="team-count">꼭 참석 {requiredCount}명</span>
          </div>
          {attendees.map((a) => (
            <div key={a.id} className="profile-row compact">
              <div className="avatar">{avatarText(a.name)}</div>
              <div className="profile-copy">
                <div className="profile-name">
                  <span>{a.name}</span>
                </div>
                <div className="profile-meta">{SOFT_PREF_LABEL[a.id] ?? '회피 조건 없음'}</div>
              </div>
              <div className="profile-action">
                {a.role === 'host' ? (
                  <span className="role-pill host">주최자</span>
                ) : (
                  <button className={`role-pill ${a.role === 'required' ? 'required' : ''}`} onClick={() => dispatch({ type: 'TOGGLE_ROLE', id: a.id })}>
                    {a.role === 'required' ? '꼭 참석' : '선택 참석'}
                  </button>
                )}
              </div>
            </div>
          ))}
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
        <button className="primary btn-lg" onClick={() => dispatch({ type: 'COMPUTE' })}>가능한 시간 보기</button>
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
