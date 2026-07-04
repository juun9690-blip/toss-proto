import type { Dispatch, State } from '../App'

export default function ConfirmScreen({ state, dispatch }: { state: State; dispatch: Dispatch }) {
  const slot = state.confirmedSlot
  const excludedName = state.excludedId
    ? state.attendees.find((a) => a.id === state.excludedId)?.name
    : null

  return (
    <div className="flow-screen">
      <div className="flow-content stack">
      <div style={{ textAlign: 'center', padding: '8px 0' }}>
        <div className="success-mark">✓</div>
        <h1>회의가 확정됐어요</h1>
        <p className="screen-desc">
          {state.draft.title} · {slot ? `${slot.day} ${slot.hour}:00` : ''} · {state.draft.durationHours}시간 · {state.draft.location}
        </p>
      </div>

      <div className="card stack">
        <h2>참석자에게 공유됐어요</h2>
        <div className="confirm-profiles">
          {state.attendees.map((a) => (
            <div key={a.id} className="profile-row compact">
              <div className="avatar">{avatarText(a.name)}</div>
              <div className="profile-copy">
                <div className="profile-name">
                  <span>{a.name}</span>
                </div>
                <div className="profile-meta">{roleText(a.role)}</div>
              </div>
              <div className="profile-action">
                <span className={`badge ${a.id === state.excludedId ? 'off' : 'ok'}`}>
                  {a.id === state.excludedId ? '이번 미참석' : '공유 완료'}
                </span>
              </div>
            </div>
          ))}
        </div>
        {state.approvalNotes.length > 0
          ? state.approvalNotes.map((note, index) => <div className="impact" key={`${note}-${index}`}>{note}</div>)
          : state.movedNote && <div className="impact">{state.movedNote}</div>}
        {excludedName && state.approvalNotes.length === 0 && !state.movedNote && (
          <div className="impact">{excludedName} 님(선택 참석)은 이번 회의에서 빠집니다.</div>
        )}
      </div>

      <p className="note">오른쪽 캘린더에서 확정된 회의와 이동된 일정을 확인할 수 있어요.</p>

      </div>

      <div className="flow-cta confirm-action">
        <button className="primary btn-lg" onClick={() => dispatch({ type: 'RESTART' })}>새 회의 잡기</button>
      </div>
    </div>
  )
}

function avatarText(name: string): string {
  return name === '나' ? '나' : name.slice(0, 1)
}

function roleText(role: State['attendees'][number]['role']): string {
  if (role === 'host') return '주최자'
  if (role === 'required') return '꼭 참석'
  return '선택 참석'
}
