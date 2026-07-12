import { useRef, type ChangeEvent } from 'react'
import type { Dispatch, State } from '../App'
import type { MeetingMode } from '../types'

const DURATIONS = [0.5, 1, 1.5, 2]
const durText = (h: number) => (h < 1 ? `${h * 60}분` : h === 1 ? '1시간' : `${h}시간`)
const MODES: { mode: MeetingMode; label: string; note: string }[] = [
  { mode: 'inperson', label: '대면', note: '회의실까지 함께 확인할게요' },
  { mode: 'online', label: '온라인', note: '회의실 없이 잡을 수 있어요' },
  { mode: 'either', label: '둘 다 가능', note: '회의실이 있으면 잡고, 없으면 온라인으로 진행해요' },
]

export default function CreateScreen({ state, dispatch }: { state: State; dispatch: Dispatch }) {
  const { draft } = state
  const selectedTime = state.selectedSlot ? `${state.selectedSlot.day} ${state.selectedSlot.hour}:00` : null

  const setField = (k: 'title' | 'agenda') => (e: ChangeEvent<HTMLInputElement>) =>
    dispatch({ type: 'SET_DRAFT', draft: { ...draft, [k]: e.target.value } })
  const setDuration = (h: number) => {
    dispatch({ type: 'SET_DRAFT', draft: { ...draft, durationHours: h } })
    dispatch({ type: 'SET_CUSTOM_DURATION_PICKING', value: false })
  }
  const startCustomDuration = () => {
    dispatch({ type: 'SET_DRAFT', draft: { ...draft, durationHours: null } })
    dispatch({ type: 'SET_CUSTOM_DURATION_PICKING', value: true })
  }
  const setMode = (mode: MeetingMode) => dispatch({ type: 'SET_DRAFT', draft: { ...draft, mode } })

  // 순차 입력 공개 — 게이트: 제목 → 길이 → 타입.
  // 한 번 나타난 섹션은 그 방문 중 유지(단조증가). 재진입 시 값이 차 있으면 즉시 전부 렌더.
  const step1Done = draft.title.trim().length > 0
  const step2Done = draft.durationHours !== null
  const step3Done = draft.mode !== null
  const latch = useRef({ len: false, mode: false })
  latch.current.len = latch.current.len || step1Done
  latch.current.mode = latch.current.mode || (latch.current.len && step2Done)
  const canNext = step1Done && step2Done && step3Done

  return (
    <div className="flow-screen">
      <div className="flow-content stack create-form">
        <div className="create-intro">
          <h1>{selectedTime ? `${selectedTime} 회의를 만들어요` : '무엇을 위한 회의인가요?'}</h1>
        </div>

        <section className="form-section">
          <label className="field">
            회의 제목
            <input value={draft.title} onChange={setField('title')} placeholder="예: 3분기 전략 회의" />
          </label>
          <label className="field" style={{ marginBottom: 0 }}>
            아젠다
            <input value={draft.agenda} onChange={setField('agenda')} placeholder="예: 분기 전략 결정 및 부서별 승인" />
          </label>
        </section>

        {latch.current.len && (
          <section className="form-section reveal-section">
            <h2>회의 길이</h2>
            <div className="seg">
              {DURATIONS.map((h) => (
                <button key={h} className={draft.durationHours === h ? 'active' : ''} onClick={() => setDuration(h)}>{durText(h)}</button>
              ))}
              <button
                className={state.customDurationPicking ? 'active' : ''}
                aria-label="캘린더에서 회의 길이 직접 선택"
                onClick={startCustomDuration}
              >
                +
              </button>
            </div>
            {state.customDurationPicking && (
              <p className="note duration-pick-note">오른쪽 캘린더에서 시작 시간을 누른 채 원하는 길이만큼 끌어주세요.</p>
            )}
          </section>
        )}

        {latch.current.mode && (
          <section className="form-section reveal-section">
            <h2>어떻게 모이나요?</h2>
            <div className="seg mode-seg">
              {MODES.map((m) => (
                <button key={m.mode} className={draft.mode === m.mode ? 'active' : ''} onClick={() => setMode(m.mode)}>{m.label}</button>
              ))}
            </div>
          </section>
        )}
      </div>

      <div className="flow-cta action-row">
        <button className="ghost btn-lg" onClick={() => dispatch({ type: 'GOTO', screen: 'SETUP' })}>뒤로</button>
        <button className={`primary btn-lg ${canNext ? 'cta-ready' : ''}`} disabled={!canNext} onClick={() => dispatch({ type: 'GOTO', screen: 'ATTENDEES' })}>
          참석자 정하기
        </button>
      </div>
    </div>
  )
}
