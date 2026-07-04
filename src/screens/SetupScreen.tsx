import type { Dispatch, State } from '../App'
import { SOFT_PREF_LABEL } from '../data/mock'

const TEAM_TITLES: Record<string, string> = {
  me: '프로덕트 오너',
  sw: '데이터로 말하는 전략가',
  dh: '현장 감각 담당',
  mj: '숫자에 강한 운영 매니저',
  hn: '사용자 목소리 수집가',
  ji: '꼼꼼한 품질 파수꾼',
}

export default function SetupScreen({ state, dispatch }: { state: State; dispatch: Dispatch }) {
  const ctaText = state.selectedSlot
    ? `${state.selectedSlot.day} ${state.selectedSlot.hour}:00에 우리 팀 회의 잡기`
    : '우리 팀 회의 잡기'

  return (
    <div className="flow-screen">
      <div className="flow-content stack">
        <div>
          <div className="team-kicker">우리 팀이에요</div>
          <p className="screen-desc">각자의 일정 조건을 함께 보고 회의 시간을 잡아볼게요.</p>
        </div>

        <div className="profile-list">
          {state.attendees.map((a) => (
            <div key={a.id} className="profile-row">
              <div className="avatar">{avatarText(a.name)}</div>
              <div className="profile-copy">
                <div className="profile-name">
                  {a.name}
                  {a.role === 'host' && <span className="profile-role">주최자</span>}
                </div>
                <div className="profile-meta">
                  {TEAM_TITLES[a.id] ?? '팀 메이트'}
                  {' · '}
                  {SOFT_PREF_LABEL[a.id] ?? '회피 조건 없음'}
                </div>
              </div>
            </div>
          ))}
        </div>

        <p className="note">
          오른쪽 캘린더에서 시간을 누르면 아래 버튼에 선택한 시간이 반영돼요.
        </p>
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
