import { useEffect, useMemo, useReducer } from 'react'
import type { Attendee, CalEvent, Level, MeetingDraft, Proposal, Role, Room, Screen, Slot } from './types'
import { ATTENDEES, EVENTS, DEFAULT_DRAFT, ROOMS } from './data/mock'
import {
  generateProposals,
  rankCandidates,
  estimateImportance,
  roomEvents,
  bookingAt,
  roomBookingId,
  resolveSlot,
  teamAvailability,
  availableRooms,
  recommendRoom,
} from './logic/scheduling'
import StepBar from './components/StepBar'
import CalendarPane, { type SplitData, type SidePane } from './components/CalendarPane'
import type { Ghost, MarkMode } from './components/WeekGrid'
import SetupScreen from './screens/SetupScreen'
import CreateScreen from './screens/CreateScreen'
import AttendeesScreen from './screens/AttendeesScreen'
import CandidatesScreen from './screens/CandidatesScreen'
import RevealScreen from './screens/RevealScreen'
import RequestingScreen from './screens/RequestingScreen'
import RespondScreen from './screens/RespondScreen'
import ConfirmScreen from './screens/ConfirmScreen'

const MY_ID = 'me'

export interface State {
  screen: Screen
  draft: MeetingDraft
  attendees: Attendee[]
  events: CalEvent[]
  rooms: Room[]
  proposals: Proposal[]
  declinedIds: string[]
  acceptedKeys: string[]
  approvalNotes: string[]
  selected: Proposal | null
  requestMessage: string
  confirmedSlot: Slot | null
  excludedId: string | null
  movedNote: string | null
  importanceOverride: Level | null
  selectedSlot: Slot | null
  slotPicked: boolean // 사용자가 직접 시간을 골랐는지 (false면 '바로 회의 잡기'로 진입)
  conflictFocusId: string | null
  roomFocusName: string | null
}

const initial: State = {
  screen: 'SETUP',
  draft: DEFAULT_DRAFT,
  attendees: ATTENDEES,
  events: EVENTS,
  rooms: ROOMS,
  proposals: [],
  declinedIds: [],
  acceptedKeys: [],
  approvalNotes: [],
  selected: null,
  requestMessage: '',
  confirmedSlot: null,
  excludedId: null,
  movedNote: null,
  importanceOverride: null,
  selectedSlot: null,
  slotPicked: false,
  conflictFocusId: null,
  roomFocusName: null,
}

type Action =
  | { type: 'GOTO'; screen: Screen }
  | { type: 'SET_DRAFT'; draft: MeetingDraft }
  | { type: 'TOGGLE_ROLE'; id: string }
  | { type: 'SET_IMPORTANCE'; level: Level | null }
  | { type: 'SELECT_SLOT'; slot: Slot }
  | { type: 'PREVIEW_CONFLICT'; attendeeId: string }
  | { type: 'PREVIEW_ROOM'; roomName: string }
  | { type: 'COMPUTE' }
  | { type: 'CONFIRM_REQUIRED_ONLY'; slot: Slot; excludedId: string | null }
  | { type: 'SELECT_PROPOSAL'; proposal: Proposal }
  | { type: 'SET_REQUEST_MESSAGE'; message: string }
  | { type: 'SEND_REQUEST' }
  | { type: 'ACCEPT' }
  | { type: 'DECLINE' }
  | { type: 'PROPOSE_ALT' }
  | { type: 'RESTART' }

// ── 파생값 ──
export function requiredCount(attendees: Attendee[]): number {
  return attendees.filter((a) => a.role !== 'optional').length
}
export function effectiveImportance(state: State): { level: Level; reason: string; auto: Level } {
  const auto = estimateImportance(state.draft.agenda, requiredCount(state.attendees))
  if (state.importanceOverride) return { level: state.importanceOverride, reason: '직접 설정', auto: auto.level }
  return { level: auto.level, reason: auto.reason, auto: auto.level }
}

export function proposalKey(p: Proposal): string {
  return proposalTargetKey(p.action, p.whoId, p.roomName ?? '', p.slot)
}

function proposalTargetKey(action: Proposal['action'], whoId: string, roomName: string, slot: Slot): string {
  return [action, whoId, roomName, slot.day, slot.hour].join('|')
}

function isDeclined(state: State, p: Proposal | null | undefined): boolean {
  return !!p && (state.declinedIds.includes(p.id) || state.declinedIds.includes(proposalKey(p)))
}

function isMeetingReady(
  state: State,
  slot: Slot,
  events: CalEvent[],
  rooms: Room[],
  location: string,
  excludedId: string | null,
  acceptedKeys: string[],
): boolean {
  const invited = excludedId ? state.attendees.filter((a) => a.id !== excludedId) : state.attendees
  const acceptedPersonFix = resolveSlot(invited, events, slot)
  const requiredReady = teamAvailability(invited, events, slot).every((a) => {
    if (a.ok || a.att.role === 'optional') return true
    return !!acceptedPersonFix &&
      acceptedPersonFix.whoId === a.att.id &&
      acceptedKeys.includes(proposalKey(acceptedPersonFix))
  })
  const freeRooms = availableRooms(rooms, slot, invited.length)
  const selectedRoomOk = freeRooms.some((r) => r.name === location)
  return requiredReady && (selectedRoomOk || freeRooms.length > 0)
}

function resolvedLocation(state: State, slot: Slot, rooms: Room[], location: string, excludedId: string | null): string {
  const invited = excludedId ? state.attendees.filter((a) => a.id !== excludedId) : state.attendees
  const freeRooms = availableRooms(rooms, slot, invited.length)
  if (freeRooms.some((r) => r.name === location)) return location
  return recommendRoom(rooms, slot, invited.length, location)?.name ?? location
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'GOTO':
      return { ...state, screen: action.screen }
    case 'SET_DRAFT':
      return { ...state, draft: action.draft }
    case 'TOGGLE_ROLE': {
      const attendees = state.attendees.map((a) =>
        a.id === action.id && a.role !== 'host'
          ? { ...a, role: (a.role === 'required' ? 'optional' : 'required') as Role }
          : a,
      )
      return { ...state, attendees, importanceOverride: null }
    }
    case 'SET_IMPORTANCE':
      return { ...state, importanceOverride: action.level }
    case 'SELECT_SLOT':
      return { ...state, selectedSlot: action.slot, slotPicked: true, conflictFocusId: null, roomFocusName: null }
    case 'PREVIEW_CONFLICT':
      return { ...state, conflictFocusId: state.conflictFocusId === action.attendeeId ? null : action.attendeeId }
    case 'PREVIEW_ROOM':
      return { ...state, roomFocusName: state.roomFocusName === action.roomName ? null : action.roomName }
    case 'COMPUTE': {
      const proposals = generateProposals(state.attendees, state.events)
      // 시간을 안 골랐으면(바로 회의 잡기) 추천 위주로, 골랐으면 그 시간으로
      const blind = state.selectedSlot == null
      const selectedSlot = state.selectedSlot ?? proposals[0]?.slot ?? { day: '화' as const, hour: 15 }
      return { ...state, proposals, selectedSlot, slotPicked: !blind, screen: 'CANDIDATES' }
    }
    case 'CONFIRM_REQUIRED_ONLY':
      return { ...state, confirmedSlot: action.slot, excludedId: action.excludedId, movedNote: null, screen: 'CONFIRM' }
    case 'SELECT_PROPOSAL':
      return { ...state, selected: action.proposal, requestMessage: defaultRequestMessage(state, action.proposal), screen: 'REVEAL' }
    case 'SET_REQUEST_MESSAGE':
      return { ...state, requestMessage: action.message }
    case 'SEND_REQUEST':
      return { ...state, screen: 'REQUESTING' }
    case 'ACCEPT': {
      const p = state.selected
      if (!p) return state
      let events = state.events
      let rooms = state.rooms
      let location = state.draft.location
      let movedNote: string | null = null
      let excludedId: string | null = null
      if (p.action === 'moveFlex' && p.movedEventId && p.moveTo) {
        const moved = state.events.find((e) => e.id === p.movedEventId)!
        const span = moved.endHour - moved.startHour
        events = state.events.map((e) =>
          e.id === p.movedEventId ? { ...e, day: p.moveTo!.day, startHour: p.moveTo!.hour, endHour: p.moveTo!.hour + span } : e,
        )
        movedNote = `'${moved.title}' 일정이 ${p.moveTo.day} ${p.moveTo.hour}:00로 이동되었습니다. (다른 충돌 없음)`
      } else if (p.action === 'concedeSoft') {
        movedNote = `${attendeeName(state, p.whoId)} 님이 이번 회의 참석 요청을 수락했습니다.`
      } else if (p.action === 'dropOptional') {
        excludedId = p.whoId
        movedNote = `${attendeeName(state, p.whoId)} 님(선택 참석)은 이번 회의에서 제외됩니다.`
      } else if (p.action === 'moveRoomBooking' && p.roomName && p.moveTo) {
        rooms = state.rooms.map((r) => r.name === p.roomName
          ? { ...r, bookings: r.bookings.map((b) => (b.day === p.slot.day && b.hour === p.slot.hour) ? { ...b, day: p.moveTo!.day, hour: p.moveTo!.hour } : b) }
          : r,
        )
        location = p.roomName
        excludedId = p.excludeIds?.[0] ?? null
        movedNote = `${p.whoId}의 ${p.roomName} 예약을 ${p.moveTo.day} ${p.moveTo.hour}:00로 옮겨 회의실을 확보했어요.`
      }
      const nextExcludedId = excludedId ?? state.excludedId
      const nextLocation = resolvedLocation(state, p.slot, rooms, location, nextExcludedId)
      const acceptedKeys = [...state.acceptedKeys, proposalKey(p)]
      const approvalNotes = movedNote ? [...state.approvalNotes, movedNote] : state.approvalNotes
      const base = {
        ...state,
        events,
        rooms,
        draft: { ...state.draft, location: nextLocation },
        movedNote,
        excludedId: nextExcludedId,
        selected: null,
        requestMessage: '',
        acceptedKeys,
        approvalNotes,
      }
      if (isMeetingReady(state, p.slot, events, rooms, nextLocation, nextExcludedId, acceptedKeys)) {
        return { ...base, confirmedSlot: p.slot, screen: 'CONFIRM' }
      }
      return { ...base, confirmedSlot: null, selectedSlot: p.slot, slotPicked: true, conflictFocusId: null, roomFocusName: null, screen: 'CANDIDATES' }
    }
    case 'DECLINE': {
      const declinedIds = state.selected
        ? [...state.declinedIds, state.selected.id, proposalKey(state.selected)]
        : state.declinedIds
      return { ...state, declinedIds, selected: null, requestMessage: '', screen: 'CANDIDATES' }
    }
    case 'PROPOSE_ALT': {
      // '다른 시간 제안' = 이 시간은 정중히 사양하되, 주최자가 다른 시간을 이어서 고르게 함
      const declinedIds = state.selected
        ? [...state.declinedIds, state.selected.id, proposalKey(state.selected)]
        : state.declinedIds
      return {
        ...state,
        declinedIds,
        selected: null,
        requestMessage: '',
        slotPicked: false,
        conflictFocusId: null,
        roomFocusName: null,
        screen: 'CANDIDATES',
      }
    }
    case 'RESTART':
      return { ...initial }
    default:
      return state
  }
}

function attendeeName(state: State, id: string): string {
  return state.attendees.find((a) => a.id === id)?.name ?? id
}

function defaultRequestMessage(state: State, p: Proposal): string {
  const slot = `${p.slot.day} ${p.slot.hour}:00`
  if (p.action === 'moveRoomBooking') {
    return `${slot}에 ${state.draft.title}를 잡으려고 해요. 가능하시다면 ${p.roomName} 사용을 조정해주실 수 있을까요?`
  }
  if (p.action === 'moveFlex') {
    return `${slot}에 ${state.draft.title}를 잡으려고 해요. 겹치는 일정 조정이 가능하실지 확인 부탁드려요.`
  }
  if (p.action === 'concedeSoft') {
    return `${slot}이 모두에게 가장 맞는 시간이라 조심스레 여쭤봐요. 어려우시면 편하게 알려주세요.`
  }
  return `${slot} 회의는 선택 참석으로 진행해도 괜찮을지 확인 부탁드려요.`
}

export default function App() {
  const [state, dispatch] = useReducer(reducer, initial)

  useEffect(() => {
    if (state.screen !== 'REQUESTING') return
    const timer = window.setTimeout(() => dispatch({ type: 'GOTO', screen: 'RESPOND' }), 900)
    return () => window.clearTimeout(timer)
  }, [state.screen])

  const candidates = useMemo(() => rankCandidates(state.attendees, state.events), [state.attendees, state.events])
  const liveProposals = state.proposals.filter((p) => !isDeclined(state, p))
  const cal = mainCalendarView(state)

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand"><span className="mk">●</span> 일정 조율</div>
        <StepBar screen={state.screen} />
      </header>
      <div className="layout">
        <aside className="sidebar">
          {state.screen === 'SETUP' && <SetupScreen state={state} dispatch={dispatch} />}
          {state.screen === 'CREATE' && <CreateScreen state={state} dispatch={dispatch} />}
          {state.screen === 'ATTENDEES' && <AttendeesScreen state={state} dispatch={dispatch} />}
          {state.screen === 'CANDIDATES' && (
            <CandidatesScreen state={state} dispatch={dispatch} candidates={candidates} proposals={liveProposals} />
          )}
          {state.screen === 'REVEAL' && <RevealScreen state={state} dispatch={dispatch} />}
          {state.screen === 'REQUESTING' && <RequestingScreen state={state} />}
          {state.screen === 'RESPOND' && <RespondScreen state={state} dispatch={dispatch} />}
          {state.screen === 'CONFIRM' && <ConfirmScreen state={state} dispatch={dispatch} />}
        </aside>
        <main className="calendar-pane">
          <CalendarPane
            attendees={state.attendees}
            events={cal.events}
            highlight={cal.highlight}
            markEventId={cal.markEventId}
            markMode={cal.markMode}
            ghost={cal.ghost}
            split={cal.split}
            title={cal.title}
            rangeText={cal.rangeText}
            onPickSlot={state.screen === 'CANDIDATES' || state.screen === 'SETUP' || state.screen === 'CREATE' || state.screen === 'ATTENDEES' ? (slot) => dispatch({ type: 'SELECT_SLOT', slot }) : undefined}
          />
        </main>
      </div>
    </div>
  )
}

interface CalView {
  events: CalEvent[]
  highlight: Slot | null
  markEventId: string | null
  markMode?: MarkMode
  ghost?: Ghost | null
  split?: SplitData | null
  title?: string
  rangeText?: string
}

function mainCalendarView(state: State): CalView {
  const myEvents = state.events.filter((e) => e.ownerId === MY_ID)
  const base: CalView = { events: myEvents, highlight: null, markEventId: null }

  switch (state.screen) {
    case 'SETUP':
      return { ...base, highlight: state.selectedSlot }
    case 'CREATE':
      return { ...base, highlight: state.selectedSlot }
    case 'ATTENDEES':
      return { ...base, highlight: state.selectedSlot }
    case 'CANDIDATES': {
      const preview = state.selectedSlot ? buildCandidatesPreview(state, state.selectedSlot, myEvents) : null
      if (preview) return { ...base, split: preview }
      return { ...base, highlight: state.selectedSlot }
    }
    case 'REVEAL': {
      const p = state.selected
      if (!p) return base
      return { ...base, split: buildSplit(state, p, myEvents) }
    }
    case 'REQUESTING': {
      const p = state.selected
      if (!p) return base
      return buildRespondCalendar(state, p)
    }
    case 'RESPOND': {
      const p = state.selected
      if (!p) return base
      return buildRespondCalendar(state, p)
    }
    case 'CONFIRM': {
      const p = state.selected
      if (p?.action === 'moveFlex' && p.movedEventId) {
        const ev = state.events.find((e) => e.id === p.movedEventId)
        return { events: ev ? [...myEvents, ev] : myEvents, highlight: state.confirmedSlot, markEventId: ev?.id ?? null, markMode: 'moved' }
      }
      return { ...base, highlight: state.confirmedSlot }
    }
    default:
      return base
  }
}

function buildRespondCalendar(state: State, p: Proposal): CalView {
  if (p.action === 'moveRoomBooking' && p.roomName) {
    const room = state.rooms.find((r) => r.name === p.roomName)
    return {
      events: room ? roomEvents(room) : [],
      highlight: p.slot,
      markEventId: p.movedEventId ?? null,
      markMode: 'requestable',
      title: `${p.roomName} 시간표`,
      rangeText: `${p.whoId}에 보이는 요청 화면 · ${p.slot.day} ${p.slot.hour}:00`,
    }
  }
  const who = state.attendees.find((a) => a.id === p.whoId)
  const theirReal = state.events.filter((e) => e.ownerId === p.whoId)
  const base: CalView = {
    events: theirReal,
    highlight: p.slot,
    markEventId: null,
    title: `${who?.name ?? '상대'} 캘린더`,
    rangeText: `${who?.name ?? '상대'} 님에게 보이는 요청 화면 · ${p.slot.day} ${p.slot.hour}:00`,
  }

  if (p.action === 'moveFlex' && p.movedEventId) {
    const ev = state.events.find((e) => e.id === p.movedEventId)
    const span = ev ? ev.endHour - ev.startHour : 1
    return {
      ...base,
      markEventId: p.movedEventId,
      markMode: 'moveAsk',
      ghost: p.moveTo ? { day: p.moveTo.day, startHour: p.moveTo.hour, endHour: p.moveTo.hour + span, label: '여기로 옮겨져요' } : null,
    }
  }
  if (p.action === 'concedeSoft') {
    const softBlock: CalEvent = {
      id: 'soft-mark',
      ownerId: p.whoId,
      day: p.slot.day,
      startHour: p.slot.hour,
      endHour: p.slot.hour + 1,
      title: '평소 피하는 시간대',
      kind: 'flex',
    }
    return { ...base, events: [...theirReal, softBlock], markEventId: 'soft-mark', markMode: 'attendAsk' }
  }

  const conflict = theirReal.find((e) => e.day === p.slot.day && p.slot.hour >= e.startHour && p.slot.hour < e.endHour)
  return { ...base, markEventId: conflict?.id ?? null, markMode: 'requestable' }
}

// 시간 확인 단계의 미리보기: 내 캘린더 + (확인 중인 사람) + (확인 중인 회의실)
function buildCandidatesPreview(state: State, slot: Slot, myEvents: CalEvent[]): SplitData | null {
  const panes: SidePane[] = [{ title: '내 캘린더', events: myEvents, highlight: slot }]

  const who = state.attendees.find((a) => a.id === state.conflictFocusId)
  if (who) {
    const theirReal = state.events.filter((e) => e.ownerId === who.id)
    const conflict = theirReal.find((e) => e.day === slot.day && slot.hour >= e.startHour && slot.hour < e.endHour)
    const currentProposal = resolveSlot(state.attendees, state.events, slot)
    const declined = currentProposal?.whoId === who.id && isDeclined(state, currentProposal)
    const fieldwork = who.softPrefs.some((pref) => pref.type === 'fieldwork' && pref.days.includes(slot.day) && slot.hour >= 9 && slot.hour < 12)
    const softConflict: CalEvent | null = conflict ? null : {
      id: 'availability-mark', ownerId: who.id, day: slot.day,
      startHour: fieldwork ? 9 : slot.hour, endHour: fieldwork ? 12 : slot.hour + 1,
      title: availabilityLabel(who, slot), kind: 'fixed',
    }
    const events = softConflict ? [...theirReal, softConflict] : theirReal
    panes.push({ title: `${who.name} 캘린더`, events, highlight: slot, markEventId: conflict?.id ?? softConflict?.id ?? null, markMode: declined ? 'conflict' : 'requestable' })
  }

  const room = state.rooms.find((r) => r.name === state.roomFocusName)
  if (room) {
    const booking = bookingAt(room, slot)
    const declined = booking
      ? state.declinedIds.includes(proposalTargetKey('moveRoomBooking', booking.by, room.name, slot))
      : false
    panes.push({
      title: `${room.name} 시간표`,
      events: roomEvents(room),
      highlight: slot,
      markEventId: booking ? roomBookingId(room, slot.day, slot.hour) : null,
      markMode: booking ? (declined ? 'conflict' : 'requestable') : 'requestable',
    })
  }

  if (panes.length === 1) return null
  return { day: slot.day, title: '일정 확인', note: `${slot.day} ${slot.hour}:00 상황을 나란히 확인해요`, panes }
}

function availabilityLabel(att: Attendee, slot: Slot): string {
  const hasPostLunch = att.softPrefs.some((p) => p.type === 'avoidPostLunch') && slot.hour === 13
  if (hasPostLunch) return '평소 피하는 시간대'
  return '외근 시간대'
}

// 조정안 1건을 '내 캘린더 + 상대(사람/회의실)' 분할로 변환
function buildSplit(state: State, p: Proposal, myEvents: CalEvent[]): SplitData {
  const who = state.attendees.find((a) => a.id === p.whoId)
  const theirReal = state.events.filter((e) => e.ownerId === p.whoId)
  const mine: SidePane = { title: '내 캘린더', events: myEvents, highlight: p.slot }

  if (p.action === 'moveFlex' && p.movedEventId && p.moveTo) {
    const ev = state.events.find((e) => e.id === p.movedEventId)
    const span = ev ? ev.endHour - ev.startHour : 1
    return { day: p.slot.day, panes: [mine, {
      title: `${who?.name} 캘린더`, events: theirReal, highlight: p.slot, markEventId: p.movedEventId, markMode: 'requestable',
      ghost: { day: p.moveTo.day, startHour: p.moveTo.hour, endHour: p.moveTo.hour + span, label: '여기로 이동' },
    }] }
  }
  if (p.action === 'concedeSoft') {
    const softBlock: CalEvent = { id: 'soft-mark', ownerId: p.whoId, day: p.slot.day, startHour: 13, endHour: 14, title: '평소 점심 직후 회피', kind: 'flex' }
    return { day: p.slot.day, panes: [mine, { title: `${who?.name} 캘린더`, events: [...theirReal, softBlock], highlight: p.slot, markEventId: 'soft-mark', markMode: 'requestable' }] }
  }
  if (p.action === 'moveRoomBooking' && p.roomName && p.moveTo) {
    const room = state.rooms.find((r) => r.name === p.roomName)
    return {
      day: p.slot.day,
      title: `회의실 예약 확인 · ${p.slot.day}요일`,
      note: '회의실 시간표에서 예약된 시간을 확인해요',
      panes: [mine, {
        title: `${p.roomName} 시간표`, events: room ? roomEvents(room) : [], highlight: p.slot, markEventId: p.movedEventId, markMode: 'requestable',
        ghost: { day: p.moveTo.day, startHour: p.moveTo.hour, endHour: p.moveTo.hour + 1, label: '대안 시간' },
      }],
    }
  }
  // dropOptional: 그 시간에 겹친 상대 일정을 불참 근거로 표시
  const conflict = theirReal.find((e) => e.day === p.slot.day && p.slot.hour >= e.startHour && p.slot.hour < e.endHour)
  return { day: p.slot.day, panes: [mine, { title: `${who?.name} 캘린더`, events: theirReal, highlight: p.slot, markEventId: conflict?.id ?? null, markMode: 'requestable' }] }
}

export type Dispatch = React.Dispatch<Action>
