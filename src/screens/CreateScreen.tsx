import type { Dispatch, State } from '../App'

const DURATIONS = [0.5, 1, 1.5]
const durText = (h: number) => (h < 1 ? `${h * 60}분` : h === 1 ? '1시간' : `${h}시간`)

export default function CreateScreen({ state, dispatch }: { state: State; dispatch: Dispatch }) {
  const { draft } = state
  const selectedTime = state.selectedSlot ? `${state.selectedSlot.day} ${state.selectedSlot.hour}:00` : null

  const setField = (k: 'title' | 'agenda') => (e: React.ChangeEvent<HTMLInputElement>) =>
    dispatch({ type: 'SET_DRAFT', draft: { ...draft, [k]: e.target.value } })
  const setDuration = (h: number) => dispatch({ type: 'SET_DRAFT', draft: { ...draft, durationHours: h } })

  return (
    <div className="flow-screen">
      <div className="flow-content stack create-form">
        <div className="create-intro">
          <h1>{selectedTime ? `${selectedTime} 회의를 만들어요` : '무엇을 위한 회의인가요?'}</h1>
        </div>

        <section className="form-section">
          <label className="field">
            회의 제목
            <input value={draft.title} onChange={setField('title')} />
          </label>
          <label className="field" style={{ marginBottom: 0 }}>
            아젠다
            <input value={draft.agenda} onChange={setField('agenda')} />
          </label>
        </section>

        <section className="form-section">
          <h2>회의 길이</h2>
          <div className="seg">
            {DURATIONS.map((h) => (
              <button key={h} className={draft.durationHours === h ? 'active' : ''} onClick={() => setDuration(h)}>{durText(h)}</button>
            ))}
          </div>
        </section>
      </div>

      <div className="flow-cta action-row">
        <button className="ghost btn-lg" onClick={() => dispatch({ type: 'GOTO', screen: 'SETUP' })}>뒤로</button>
        <button className="primary btn-lg" onClick={() => dispatch({ type: 'GOTO', screen: 'ATTENDEES' })}>참석자 정하기</button>
      </div>
    </div>
  )
}
