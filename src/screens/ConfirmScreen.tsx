import type { Dispatch, State } from '../App'
import RoundedCheck from '../components/RoundedCheck'
import ProfileAvatar from '../components/ProfileAvatar'
import type { Day } from '../types'

const CONFIRM_DATES: Record<Day, string> = {
  월: '7월 6일 월요일',
  화: '7월 7일 화요일',
  수: '7월 8일 수요일',
  목: '7월 9일 목요일',
  금: '7월 10일 금요일',
}

export default function ConfirmScreen({ state, dispatch }: { state: State; dispatch: Dispatch }) {
  const slot = state.confirmedSlot
  const meetingTitle = state.draft.title.trim() || '회의'
  const meeting = [...state.confirmedMeetings]
    .reverse()
    .find((item) => item.title === meetingTitle && slot && item.slot.day === slot.day && item.slot.hour === slot.hour)
  const excludedName = state.excludedId
    ? state.attendees.find((a) => a.id === state.excludedId)?.name
    : null
  const timeText = slot ? `${CONFIRM_DATES[slot.day]} ${slot.hour}:00` : ''
  const isOnline = state.draft.location === '온라인'
  const locationText = isOnline ? '온라인' : state.draft.location

  return (
    <div className="flow-screen">
      <div className="flow-content stack">
      <div className="confirm-hero">
        <div className="success-mark"><RoundedCheck /></div>
        <p className="confirm-kicker">스케줄을 공유했어요</p>
        <h1>{meetingTitle}</h1>
        <div className="confirm-meta" aria-label="공유된 스케줄 정보">
          {timeText && <span>{timeText}</span>}
          <span>{locationText}</span>
        </div>
        {isOnline && <p className="confirm-subnote">참석자에게 온라인 링크가 공유돼요</p>}
      </div>

      <div className="card stack">
        <h2>참석자에게 공유됐어요</h2>
        <div className="confirm-profiles">
          {state.attendees.map((a) => {
            const response = meeting?.responses.find((item) => item.attendeeId === a.id)
            const badge = confirmBadge(a.role, response)
            return (
              <div key={a.id} className="profile-row compact">
                <ProfileAvatar id={a.id} />
                <div className="profile-copy">
                  <div className="profile-name">
                    <span>{a.name}</span>
                  </div>
                  <div className="profile-meta">{roleText(a.role)}</div>
                </div>
                <div className="profile-action">
                  <span className={`badge ${badge.tone}`}>
                    {badge.label}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
        {state.approvalNotes.length > 0
          ? state.approvalNotes.map((note, index) => <div className="impact" key={`${note}-${index}`}>{note}</div>)
          : state.movedNote && <div className="impact">{state.movedNote}</div>}
        {excludedName && state.approvalNotes.length === 0 && !state.movedNote && (
          <div className="impact">{excludedName} 님(선택 참석)은 이번 회의에서 빠집니다.</div>
        )}
      </div>

      <p className="note">참석 확인 현황은 내 캘린더에서 볼 수 있어요.</p>

      </div>

      <div className="flow-cta confirm-action">
        <button className="primary btn-lg" onClick={() => dispatch({ type: 'GO_HOME' })}>내 캘린더로 돌아가기</button>
      </div>
    </div>
  )
}

function roleText(role: State['attendees'][number]['role']): string {
  if (role === 'host') return '주최자'
  if (role === 'required') return '꼭 참석'
  return '선택 참석'
}

function confirmBadge(
  role: State['attendees'][number]['role'],
  response?: State['confirmedMeetings'][number]['responses'][number],
): { label: string; tone: string } {
  if (role === 'host') return { label: '주최자', tone: 'off' }
  if (response?.status === 'excluded') return { label: '이번 미참석', tone: 'off' }
  if (response?.status === 'confirmed' || response?.via === 'request') return { label: '참석 확인', tone: 'ok' }
  return { label: '공유됨 · 확인 전', tone: 'warn' }
}
