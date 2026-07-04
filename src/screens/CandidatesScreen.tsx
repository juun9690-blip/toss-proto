import { useState } from 'react'
import { proposalKey, type Dispatch, type State } from '../App'
import type { Candidate, Day, Proposal, Slot } from '../types'
import { DAYS, HOURS } from '../types'
import { resolveSlot, teamAvailability, sameSlot, slotEarlier, roomStatuses, availableRooms, recommendRoom, resolveRoom, roomProposalFor, bookingAt } from '../logic/scheduling'

interface Props {
  state: State
  dispatch: Dispatch
  candidates: Candidate[]
  proposals: Proposal[]
}

const slotText = (s: Slot) => `${s.day} ${s.hour}:00`
const dayText = (d: Day) => `${d}요일`
const ROOM_FILTERS = ['추천', '소형', '중형', '대형'] as const
type RoomFilter = typeof ROOM_FILTERS[number]
const MEMBER_TABS = ['blocked', 'available', 'all'] as const
type MemberTab = typeof MEMBER_TABS[number]

export default function CandidatesScreen({ state, dispatch, candidates, proposals }: Props) {
  const { attendees, events, draft } = state
  const slot = state.selectedSlot ?? { day: '화' as Day, hour: 15 }
  const [memberTab, setMemberTab] = useState<MemberTab>('blocked')
  const [roomFilter, setRoomFilter] = useState<RoomFilter>('추천')
  const [altOpen, setAltOpen] = useState(!state.slotPicked) // 지정 진입이면 접힘, 바로 진입이면 펼침

  const pick = (next: Partial<Slot>) =>
    dispatch({ type: 'SELECT_SLOT', slot: { day: next.day ?? slot.day, hour: next.hour ?? slot.hour } })
  const setRoom = (name: string) => dispatch({ type: 'SET_DRAFT', draft: { ...draft, location: name } })
  const showRoomSchedule = (name: string, available: boolean) => {
    if (available) setRoom(name)
    dispatch({ type: 'PREVIEW_ROOM', roomName: name })
  }

  // ── 사람(시간) ──
  const avail = teamAvailability(attendees, events, slot)
  const okCount = avail.filter((a) => a.ok).length
  const allOk = okCount === avail.length
  const blockedMembers = avail.filter((a) => !a.ok)
  const availableMembers = avail.filter((a) => a.ok)
  const shownMembers = memberTab === 'all' ? avail : memberTab === 'available' ? availableMembers : blockedMembers
  const optionalMissing = blockedMembers.filter((a) => a.att.role === 'optional')
  const optionalIds = optionalMissing.map((a) => a.att.id)
  const isDeclined = (p: Proposal | null | undefined) => !!p && (state.declinedIds.includes(p.id) || state.declinedIds.includes(proposalKey(p)))
  const isAccepted = (p: Proposal | null | undefined) => !!p && state.acceptedKeys.includes(proposalKey(p))
  const rawPeopleFix = resolveSlot(attendees, events, slot)
  const peopleFixAccepted = isAccepted(rawPeopleFix)
  const requiredBlockers = blockedMembers.filter((a) =>
    a.att.role !== 'optional' && !(peopleFixAccepted && rawPeopleFix?.whoId === a.att.id),
  )
  const requiredReady = requiredBlockers.length === 0
  const peopleFixDeclined = isDeclined(rawPeopleFix)
  const peopleFix = peopleFixDeclined || peopleFixAccepted ? null : rawPeopleFix
  const personHero = !requiredReady && peopleFix && (peopleFix.action === 'moveFlex' || peopleFix.action === 'concedeSoft') ? peopleFix : null
  const peopleHard = !requiredReady && !personHero

  // ── 장소 (사람 다음 자원) ──
  const stateRooms = state.rooms
  const needCap = attendees.length
  const roomList = roomStatuses(stateRooms, slot, needCap)
  const freeRooms = availableRooms(stateRooms, slot, needCap)
  const availCount = freeRooms.length
  const freeRoomExists = availCount > 0
  const recRoom = recommendRoom(stateRooms, slot, needCap, draft.location)
  const selectedRoomOk = freeRooms.some((r) => r.name === draft.location)
  const roomNeedsSwap = freeRoomExists && !selectedRoomOk
  // 정원이 맞는 방이 하나라도 있으면(비었거나 예약됐거나) 방은 어떻게든 확보 가능
  const capOkRoomExists = roomList.some(({ reason }) => reason !== '인원 초과')
  const roomReady = freeRoomExists || selectedRoomOk

  // 추천은 전체 목록이 아니라, 지금 선택한 시간에 의미 있는 회의실만 큐레이션한다.
  const roomStateRank = (item: typeof roomList[number]) => {
    if (item.available) return 0
    if (item.adjustable) return 1
    if (item.reason === '예약됨') return 2
    return 3
  }
  const roomFit = (capacity: number) => Math.max(0, capacity - needCap)
  const rankedRooms = [...roomList].sort((a, b) => {
    const aRecommended = recRoom && a.room.name === recRoom.name ? 0 : 1
    const bRecommended = recRoom && b.room.name === recRoom.name ? 0 : 1
    if (aRecommended !== bRecommended) return aRecommended - bRecommended
    const stateDiff = roomStateRank(a) - roomStateRank(b)
    if (stateDiff !== 0) return stateDiff
    const fitDiff = roomFit(a.room.capacity) - roomFit(b.room.capacity)
    if (fitDiff !== 0) return fitDiff
    return a.room.name.localeCompare(b.room.name)
  })
  const visibleRooms = roomFilter === '추천'
    ? rankedRooms.slice(0, 3)
    : rankedRooms.filter(({ room }) => roomSize(room.capacity) === roomFilter)

  const blocked = peopleHard || (requiredReady && !capOkRoomExists)

  // 대안 시간
  const recSlots = proposals.map((p) => p.slot)
  const reqSlots = candidates.filter((c) => c.tag === 'requiredOnly').map((c) => c.slot)
    .filter((s) => !recSlots.some((r) => sameSlot(r, s))).slice(0, 3)
  const altSlots = [...recSlots, ...reqSlots].filter((s) => !sameSlot(s, slot)).sort(slotEarlier)
  const altSuggestions = altSlots.slice(0, 4)
  // 바로 진입 시 맨 위에 보여줄 추천 시간 (현재 슬롯 포함, 중복 제거)
  const recommendedTimes = [...recSlots, ...reqSlots]
    .filter((s, i, arr) => arr.findIndex((x) => sameSlot(x, s)) === i)
    .sort(slotEarlier)
    .slice(0, 5)
  const slotRoomName = (s: Slot) => {
    const room = recommendRoom(stateRooms, s, needCap, draft.location)
    if (room) return room.name
    return resolveRoom(stateRooms, s, needCap, optionalIds)?.roomName ?? '회의실 확인 필요'
  }
  const recMain = (s: Slot) => `${slotText(s)} · ${slotRoomName(s)}`
  const recLabel = (s: Slot) => (recSlots.some((r) => sameSlot(r, s)) ? '조정하면 모두 가능' : '꼭 참석자 가능')

  // 확인 중인 회의실 (예약된 방을 눌러 시간표 확인 → 그 방에 조정 요청)
  const previewRoom = state.rooms.find((r) => r.name === state.roomFocusName) ?? null
  const previewBooking = previewRoom ? bookingAt(previewRoom, slot) : null
  const rawRoomRequest = previewRoom && previewBooking ? roomProposalFor(previewRoom, slot, optionalIds) : null
  const roomRequestDeclined = isDeclined(rawRoomRequest)
  const roomRequest = roomRequestDeclined ? null : rawRoomRequest
  const personDecision = personHero
  const roomDecision = roomRequest
  const hasDecisionAction = !!personDecision || !!roomDecision

  // 종합 액션 (사람 시간 우선 → 정 안 되면 회의실 예약 조정)
  const goFix = () => {
    if (roomNeedsSwap && recRoom) setRoom(recRoom.name)
    if (personHero) dispatch({ type: 'SELECT_PROPOSAL', proposal: personHero })
  }
  const goRoomDecision = () => {
    if (roomDecision) dispatch({ type: 'SELECT_PROPOSAL', proposal: roomDecision })
  }
  const goConfirm = () => {
    if (!selectedRoomOk && recRoom) setRoom(recRoom.name)
    dispatch({ type: 'CONFIRM_REQUIRED_ONLY', slot, excludedId: optionalIds[0] ?? null })
  }

  return (
    <div className="flow-screen">
      <div className="flow-content stack">
        <div>
          <h1>{state.slotPicked ? `${dayText(slot.day)} ${slot.hour}:00에 맞춰볼까요?` : '언제 모이면 좋을까요?'}</h1>
        </div>

        {state.slotPicked && altSuggestions.length > 0 && (
          <section className="top-alt-section">
            <button className="alt-toggle" onClick={() => setAltOpen((o) => !o)}>
              <span>가능한 가장 빠른 일정으로 볼까요?</span>
              <span className={`alt-toggle-arrow ${altOpen ? 'open' : ''}`} aria-hidden="true" />
            </button>
            {altOpen && (
              <div className="alt-slots">
                {altSuggestions.map((s) => (
                  <button key={slotText(s)} className="alt-slot-button" onClick={() => dispatch({ type: 'SELECT_SLOT', slot: s })}>
                    <span>{recMain(s)}</span><em>{recLabel(s)}</em>
                  </button>
                ))}
              </div>
            )}
          </section>
        )}

        {/* 바로 진입(시간 안 고름) → 추천 시간을 맨 먼저 */}
        {!state.slotPicked && recommendedTimes.length > 0 && (
          <section className="top-alt-section">
            <button className="alt-toggle" onClick={() => setAltOpen((o) => !o)}>
              <span>가능한 가장 빠른 일정으로 볼까요?</span>
              <span className={`alt-toggle-arrow ${altOpen ? 'open' : ''}`} aria-hidden="true" />
            </button>
            {altOpen && (
              <div className="alt-slots">
                {recommendedTimes.map((s) => (
                  <button key={slotText(s)} className="alt-slot-button" onClick={() => dispatch({ type: 'SELECT_SLOT', slot: s })}>
                    <span>{recMain(s)}</span><em>{recLabel(s)}</em>
                  </button>
                ))}
              </div>
            )}
          </section>
        )}

        {/* 요일·시간 */}
        <section className="check-section time-check-section">
          <div>
            <div className="note" style={{ marginBottom: 5 }}>요일</div>
            <div className="seg">
              {DAYS.map((d) => <button key={d} className={slot.day === d ? 'active' : ''} onClick={() => pick({ day: d })}>{d}</button>)}
            </div>
          </div>
          <div>
            <div className="note" style={{ marginBottom: 5 }}>시간</div>
            <div className="row">
              {HOURS.map((h) => (
                <button key={h} className={`timechip ${slot.hour === h ? 'active' : ''}`} onClick={() => pick({ hour: h })}>{h}:00</button>
              ))}
            </div>
          </div>
        </section>

        {/* 팀 — 기본은 '안 되는 사람'만, 펼치면 전체 */}
        <section className="check-section team-check-section">
          <div className="spread">
            <h2 style={{ margin: 0 }}>우리 팀</h2>
          </div>
          <div className="member-tabs">
            <button className={memberTab === 'blocked' ? 'active' : ''} onClick={() => setMemberTab('blocked')}>
              안 되는 사람 {blockedMembers.length}
            </button>
            <button className={memberTab === 'available' ? 'active' : ''} onClick={() => setMemberTab('available')}>
              가능한 사람 {availableMembers.length}
            </button>
            <button className={memberTab === 'all' ? 'active' : ''} onClick={() => setMemberTab('all')}>
              전체 {avail.length}
            </button>
          </div>

          {shownMembers.length === 0 ? (
            <div className="all-clear">{memberTab === 'blocked' ? '이 시간엔 우리 팀 모두 가능해요' : '표시할 팀원이 없어요'}</div>
          ) : (
            <div className="avail">
              {shownMembers.map((a) => {
                const approved = !a.ok && peopleFixAccepted && rawPeopleFix?.whoId === a.att.id
                return (
                <div
                  key={a.att.id}
                  className={`avail-item ${a.ok ? '' : 'blocked'} ${approved ? 'accepted' : ''} ${a.status} ${!a.ok && a.att.role === 'optional' ? 'optional-blocked' : ''} ${!a.ok && peopleFixDeclined && rawPeopleFix?.whoId === a.att.id ? 'declined' : ''} ${state.conflictFocusId === a.att.id ? 'active' : ''}`}
                >
                  <div className="avail-person">
                    <div className="profile-row mini">
                      <div className="avatar">{avatarText(a.att.name)}</div>
                      <div className="profile-copy">
                        <div className="profile-name">
                          <span>{a.att.name}</span>
                          {a.att.role === 'host' && <span className="badge">주최자</span>}
                          {a.att.role === 'required' && <span className="badge hero-soft">꼭 참석</span>}
                          {a.att.role === 'optional' && <span className="badge">선택 참석</span>}
                        </div>
                      </div>
                    </div>
                    {(a.ok || approved) && <span className={`av-ok ${approved ? 'approved' : ''}`}>{approved ? '승인 완료' : '가능'}</span>}
                  </div>
                  {!a.ok && !approved && (
                    <button className="inline-action" onClick={() => dispatch({ type: 'PREVIEW_CONFLICT', attendeeId: a.att.id })}>
                      {state.conflictFocusId === a.att.id ? '보는 중' : '캘린더 보기'}
                    </button>
                  )}
                </div>
                )
              })}
            </div>
          )}

          {peopleHard && (
            <p className={`section-hint ${peopleFixDeclined ? 'danger' : ''}`}>
              {peopleFixDeclined ? '이미 상대방이 일정 조정을 하기 어려운 시간이에요.' : '일정 조정 요청이 필요한 시간이에요.'}
            </p>
          )}
        </section>

        {/* 회의실 */}
        <section className="check-section room-check-section">
          <div className="spread">
            <div>
              <h2 style={{ margin: 0 }}>회의실</h2>
              <div className="note">{availCount}곳이 이 시간에 가능해요</div>
            </div>
          </div>
          <div className="place-filters">
            {ROOM_FILTERS.map((filter) => (
              <button key={filter} className={roomFilter === filter ? 'active' : ''} onClick={() => setRoomFilter(filter)}>
                {filter}
              </button>
            ))}
          </div>
          <div className="room-list">
            {visibleRooms.map(({ room, available, reason, booking }) => {
              const capExceeded = reason === '인원 초과'    // 물리적 제약 → 조정 불가
              const isBooked = !available && !capExceeded    // 다른 팀 예약 → 시간표 확인/요청 가능
              const isActive = available && draft.location === room.name
              const roomFocused = state.roomFocusName === room.name
              const roomDeclined = isBooked && isDeclined(roomProposalFor(room, slot, optionalIds))
              return (
                <button
                  key={room.name}
                  className={`room-option ${isActive ? 'active' : ''} ${isBooked ? 'booked' : ''} ${isBooked && booking?.movable ? 'negotiable' : ''} ${roomDeclined ? 'declined' : ''} ${roomFocused ? 'focused' : ''}`}
                  disabled={capExceeded}
                  onClick={() => showRoomSchedule(room.name, available)}
                >
                  <span>
                    <strong>{room.name}</strong>
                    <small>{room.meta}{booking ? ` · ${booking.by} 예약` : ''}</small>
                  </span>
                  <em>{available ? '가능' : capExceeded ? '인원 초과' : (roomFocused ? '보는 중' : '예약 보기')}</em>
                </button>
              )
            })}
          </div>

          {/* 확인 중인 예약 회의실 → 그 팀에 조정 요청 */}
          {previewRoom && previewBooking && (
            <div className="room-request">
              <div className="fix-copy">
                <div className="fix-title">{previewBooking.by} 예약이 잡혀 있어요</div>
                <div className="fix-detail" style={{ marginBottom: 0 }}>
                  {roomRequestDeclined
                    ? '이미 상대방이 일정 조정을 하기 어려운 시간이에요.'
                    : `${previewRoom.name} 시간표를 확인하고, 이 시간 사용 가능 여부를 물어볼 수 있어요.`}
                </div>
              </div>
              {roomRequestDeclined ? (
                <span className="badge danger">조정 어려움</span>
              ) : (
                <span className="badge warn">요청 가능</span>
              )}
            </div>
          )}
          {!capOkRoomExists && <p className="section-hint">이 시간엔 정원이 맞는 회의실이 없어요.</p>}
        </section>

        {/* 종합 — 하나의 결정 존 */}
        <div className="decision-zone">
          {state.approvalNotes.length > 0 && (
            <div className="approval-stack">
              {state.approvalNotes.map((note, index) => (
                <div className="approval-line" key={`${note}-${index}`}>
                  <span>✓</span>
                  <p>{note}</p>
                </div>
              ))}
            </div>
          )}
          {hasDecisionAction ? (
            <div className="decision-actions">
              {personDecision && (
                <button className="decision-action" onClick={goFix}>
                  <span>
                    <b>{personCtaTitle(personDecision, state)}</b>
                    <small>{personCtaMeta(personDecision, state)}</small>
                  </span>
                  <em>참석자</em>
                </button>
              )}
              {roomDecision && (
                <button className="decision-action" onClick={goRoomDecision}>
                  <span>
                    <b>{roomDecision.whoId}에 회의실 사용 요청</b>
                    <small>{roomDecision.roomName} · {slotText(roomDecision.slot)}</small>
                  </span>
                  <em>회의실</em>
                </button>
              )}
            </div>
          ) : blocked ? null : roomReady ? (
            <button className="primary btn-lg btn-block" onClick={goConfirm}>
              이 시간으로 확정 · {roomNeedsSwap ? recRoom!.name : draft.location}
            </button>
          ) : (
            <div className={`empty ${roomRequestDeclined ? 'danger' : ''}`}>
              {roomRequestDeclined
                ? '이미 상대방이 일정 조정을 하기 어려운 시간이에요. 다른 시간을 선택해보세요.'
                : '빈 회의실이 없어요. 위에서 예약된 회의실을 눌러 시간표를 보고, 그 팀에 조정을 요청해보세요.'}
            </div>
          )}

          <button className="ghost btn-block inline-flow-action" onClick={() => dispatch({ type: 'GOTO', screen: 'ATTENDEES' })}>← 참석자 다시 보기</button>
        </div>
      </div>
    </div>
  )
}

function personCtaTitle(fix: Proposal, state: State): string {
  const name = state.attendees.find((a) => a.id === fix.whoId)?.name ?? '팀원'
  if (fix.action === 'moveFlex') return `${name} 님에게 일정 조정 요청`
  if (fix.action === 'concedeSoft') return `${name} 님에게 참석 가능 여부 확인`
  return `${name} 님 없이 진행하기`
}

function personCtaMeta(fix: Proposal, state: State): string {
  if (fix.action === 'moveFlex') {
    const eventTitle = state.events.find((e) => e.id === fix.movedEventId)?.title ?? '겹치는 일정'
    return `${eventTitle} · ${slotText(fix.slot)}`
  }
  if (fix.action === 'concedeSoft') return `평소 피하는 시간 · ${slotText(fix.slot)}`
  return `선택 참석 · ${slotText(fix.slot)}`
}

function avatarText(name: string): string {
  return name === '나' ? '나' : name.slice(0, 1)
}

function roomSize(capacity: number): Exclude<RoomFilter, '추천'> {
  if (capacity <= 6) return '소형'
  if (capacity <= 8) return '중형'
  return '대형'
}
