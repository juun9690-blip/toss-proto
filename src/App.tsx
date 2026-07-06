import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
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
  moveTargets,
  sameSlot,
  roomProposalFor,
} from './logic/scheduling'
import StepBar from './components/StepBar'
import CalendarPane, { type SplitData, type SidePane, type PaneActionType, type PaneFooter } from './components/CalendarPane'
import type { Ghost, MarkMode } from './components/WeekGrid'
import SetupScreen from './screens/SetupScreen'
import CreateScreen from './screens/CreateScreen'
import AttendeesScreen from './screens/AttendeesScreen'
import CandidatesScreen from './screens/CandidatesScreen'
import RevealScreen from './screens/RevealScreen'
import RequestingScreen from './screens/RequestingScreen'
import RespondScreen from './screens/RespondScreen'
import ConfirmScreen from './screens/ConfirmScreen'
import type { HighlightInfo } from './components/WeekGrid'

const MY_ID = 'me'

// 화면 진행 순서 — 전환 방향(앞/뒤) 판별용
const SCREEN_ORDER: Screen[] = ['SETUP', 'CREATE', 'ATTENDEES', 'CANDIDATES', 'REVEAL', 'REQUESTING', 'RESPOND', 'CONFIRM']

function usePrevious<T>(value: T): T | undefined {
  const ref = useRef<T>()
  useEffect(() => {
    ref.current = value
  }, [value])
  return ref.current
}

// REQUESTING → RESPOND 역할 전환 배너에 쓸 수신자 이름
function receiverLabel(state: State): string {
  const p = state.selected
  if (!p) return '상대'
  if (p.action === 'moveRoomBooking') return p.whoId // 예약한 팀 이름
  return state.attendees.find((a) => a.id === p.whoId)?.name ?? '상대'
}

const INITIAL_ATTENDEES = ATTENDEES.map((a) =>
  a.role === 'host' ? a : { ...a, role: 'optional' as const },
)

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
  receiverMoveTo: Slot | null // moveFlex 응답: 수신자가 자기 일정을 옮길 목적지
}

const initial: State = {
  screen: 'SETUP',
  draft: DEFAULT_DRAFT,
  attendees: INITIAL_ATTENDEES,
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
  receiverMoveTo: null,
}

type Action =
  | { type: 'GOTO'; screen: Screen }
  | { type: 'SET_DRAFT'; draft: MeetingDraft }
  | { type: 'TOGGLE_ROLE'; id: string }
  | { type: 'SET_IMPORTANCE'; level: Level | null }
  | { type: 'SELECT_SLOT'; slot: Slot }
  | { type: 'PICK_MOVE_DEST'; slot: Slot }
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
    case 'PICK_MOVE_DEST':
      return { ...state, receiverMoveTo: action.slot }
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
    case 'CONFIRM_REQUIRED_ONLY': {
      // 패널에서 바로 확정해도 유효한 회의실이 잡히도록 위치를 해석한다.
      const location = resolvedLocation(state, action.slot, state.rooms, state.draft.location, action.excludedId)
      return { ...state, draft: { ...state.draft, location }, confirmedSlot: action.slot, excludedId: action.excludedId, movedNote: null, screen: 'CONFIRM' }
    }
    case 'SELECT_PROPOSAL':
      // receiverMoveTo는 '수신자가 직접 고른' 목적지만 담는다(초기엔 null → 캘린더에 주황 '옮겨야 할' 상태).
      // 추천/CTA는 RespondScreen·ACCEPT에서 `?? p.moveTo`로 폴백하므로 기본값 없이도 동작한다.
      return { ...state, selected: action.proposal, requestMessage: defaultRequestMessage(state, action.proposal), receiverMoveTo: null, screen: 'REVEAL' }
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
        const dest = state.receiverMoveTo ?? p.moveTo
        events = state.events.map((e) =>
          e.id === p.movedEventId ? { ...e, day: dest.day, startHour: dest.hour, endHour: dest.hour + span } : e,
        )
        movedNote = `'${moved.title}' 일정을 ${dest.day} ${dest.hour}:00로 옮기고 회의를 확정했어요.`
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
  const prevScreen = usePrevious(state.screen)
  // 진행 순서상 뒤로 가면 back, 아니면 fwd (초기 진입도 fwd)
  const dir =
    prevScreen && SCREEN_ORDER.indexOf(state.screen) < SCREEN_ORDER.indexOf(prevScreen) ? 'back' : 'fwd'
  const [handoffText, setHandoffText] = useState<string | null>(null)

  // REQUESTING: 전송 시퀀스 뒤 역할이 뒤집힌다 → 1300ms에 RESPOND로 전환하고,
  // 900ms에 "지금부터 상대에게 보이는 화면" 배너를 띄운다.
  useEffect(() => {
    if (state.screen !== 'REQUESTING') return
    const isRoom = state.selected?.action === 'moveRoomBooking'
    const text = `지금부터 ${receiverLabel(state)}${isRoom ? '에' : ' 님에게'} 보이는 화면이에요`
    const toRespond = window.setTimeout(() => dispatch({ type: 'GOTO', screen: 'RESPOND' }), 1300)
    const showBanner = window.setTimeout(() => setHandoffText(text), 900)
    return () => {
      window.clearTimeout(toRespond)
      window.clearTimeout(showBanner)
    }
  }, [state.screen])

  // 배너는 뜬 뒤 스스로 사라진다. (화면 전환이 REQUESTING effect의 cleanup을 부르므로,
  //  hide 타이머를 그쪽에 두면 전환 순간 취소돼 배너가 남는다 → 별도 effect로 분리)
  useEffect(() => {
    if (!handoffText) return
    const hide = window.setTimeout(() => setHandoffText(null), 2600)
    return () => window.clearTimeout(hide)
  }, [handoffText])

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
          {/* key 변경 → 리마운트 → CSS 입장 애니메이션 자동 재생 (fwd/back 방향) */}
          <div key={state.screen} className={`screen-enter ${dir}`}>
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
          </div>
        </aside>
        <main className="calendar-pane">
          <CalendarPane
            attendees={state.attendees}
            events={cal.events}
            highlight={cal.highlight}
            highlightInfo={cal.highlightInfo}
            markEventId={cal.markEventId}
            markMode={cal.markMode}
            ghost={cal.ghost}
            split={cal.split}
            title={cal.title}
            rangeText={cal.rangeText}
            candidates={cal.candidates}
            onPickSlot={
              state.screen === 'RESPOND' && state.selected?.action === 'moveFlex'
                ? (slot) => dispatch({ type: 'PICK_MOVE_DEST', slot })
                : state.screen === 'CANDIDATES' || state.screen === 'SETUP' || state.screen === 'CREATE' || state.screen === 'ATTENDEES'
                  ? (slot) => dispatch({ type: 'SELECT_SLOT', slot })
                  : undefined
            }
            onPaneAction={(a: PaneActionType) => {
              // 패널=버튼: 보고 있는 상대에게 바로 요청/확정 (UT §2)
              if (a.kind === 'proposal') dispatch({ type: 'SELECT_PROPOSAL', proposal: a.proposal })
              else dispatch({ type: 'CONFIRM_REQUIRED_ONLY', slot: a.slot, excludedId: a.excludedId })
            }}
          />
        </main>
      </div>
      {handoffText && (
        <div className="handoff-banner" role="status">
          <span className="handoff-banner-dot" aria-hidden="true" />
          {handoffText}
        </div>
      )}
    </div>
  )
}

interface CalView {
  events: CalEvent[]
  highlight: Slot | null
  highlightInfo?: HighlightInfo | null
  markEventId: string | null
  markMode?: MarkMode
  ghost?: Ghost | null
  candidates?: Slot[]
  split?: SplitData | null
  title?: string
  rangeText?: string
}

function mainCalendarView(state: State): CalView {
  const myEvents = state.events.filter((e) => e.ownerId === MY_ID)
  const highlightInfo = meetingHighlightInfo(state)
  const base: CalView = { events: myEvents, highlight: null, highlightInfo, markEventId: null }

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
      return { ...buildRespondCalendar(state, p), highlightInfo }
    }
    case 'RESPOND': {
      const p = state.selected
      if (!p) return base
      return { ...buildRespondCalendar(state, p), highlightInfo }
    }
    case 'CONFIRM': {
      const p = state.selected
      if (p?.action === 'moveFlex' && p.movedEventId) {
        const ev = state.events.find((e) => e.id === p.movedEventId)
        return { events: ev ? [...myEvents, ev] : myEvents, highlight: state.confirmedSlot, highlightInfo, markEventId: ev?.id ?? null, markMode: 'moved' }
      }
      return { ...base, highlight: state.confirmedSlot }
    }
    default:
      return base
  }
}

function meetingHighlightInfo(state: State): HighlightInfo | null {
  const title = state.draft.title.trim()
  const selectedRequired = state.attendees.some((a) => a.role === 'required')
  const meta = selectedRequired ? `${requiredCount(state.attendees)}명 꼭 참여` : undefined
  if (!title && !meta) return null
  return { title: title || '회의', meta }
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
    const picked = state.receiverMoveTo // 수신자가 직접 고른 목적지 (없으면 아직 '옮겨야 할' 주황 상태)
    const targets = ev ? moveTargets(ev, state.events, p.slot) : []
    const candidates = targets.filter((s) => !(picked && sameSlot(s, picked))).slice(0, 7)
    if (ev && picked) {
      // 고른 자리로 겹치던 일정을 옮긴다 → 주황에서 초록('가능')으로 바뀌며 이동,
      // 비워진 원래 자리엔 파란 회의(highlight)만 남는다.
      const span = ev.endHour - ev.startHour
      const movedEv: CalEvent = { ...ev, day: picked.day, startHour: picked.hour, endHour: picked.hour + span }
      const others = theirReal.filter((e) => e.id !== ev.id)
      return { ...base, events: [...others, movedEv], markEventId: ev.id, markMode: 'movedOk', candidates }
    }
    return { ...base, markEventId: p.movedEventId, markMode: 'moveAsk', candidates }
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
// 각 상대 패널에는 '보고 있는 것에 요청'하는 풋터를 붙인다 (UT §2) — 패널 자체가 버튼.
function buildCandidatesPreview(state: State, slot: Slot, myEvents: CalEvent[]): SplitData | null {
  const panes: SidePane[] = [{
    title: '내 캘린더', events: myEvents, highlight: slot, highlightInfo: meetingHighlightInfo(state),
    identity: { kind: 'person', avatar: '나' },
  }]
  const optionalIds = state.attendees.filter((a) => a.role === 'optional').map((a) => a.id)

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
    panes.push({
      title: `${who.name} 캘린더`, events, highlight: slot,
      markEventId: conflict?.id ?? softConflict?.id ?? null, markMode: declined ? 'conflict' : 'requestable',
      identity: { kind: 'person', avatar: avatarInitial(who.name) },
      footer: personFooter(who, currentProposal, declined, slot),
    })
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
      identity: { kind: 'room', badge: roomBadge(room) },
      footer: roomFooter(room, slot, declined, optionalIds),
    })
  }

  if (panes.length === 1) return null
  return { day: slot.day, title: '일정 확인', note: `${slot.day} ${slot.hour}:00 상황을 나란히 확인해요`, panes }
}

// 사람 이니셜 아바타 / 회의실 문패(층수) 배지
function avatarInitial(name: string): string {
  return name === '나' ? '나' : name.slice(0, 1)
}
function roomBadge(room: Room): string {
  const floor = /(\d+)\s*층/.exec(room.meta)?.[1]
  return floor ? `${floor}F` : '룸'
}

// UT §2 상태표 — 보고 있는 대상과 액션을 항상 일치시킨다.
function personFooter(who: Attendee, prop: Proposal | null, declined: boolean, slot: Slot): PaneFooter {
  if (prop && prop.whoId === who.id) {
    if (declined) return { label: '이미 조정이 어려운 시간이에요', tone: 'danger' }
    if (prop.action === 'dropOptional') {
      return { label: `${who.name} 님은 선택 참석 · 없이 진행하기`, tone: 'active', action: { kind: 'confirmRequiredOnly', slot, excludedId: who.id } }
    }
    const verb = prop.action === 'moveFlex' ? '일정 이동 요청' : '참석 가능 여부 확인'
    return { label: `${who.name} 님에게 ${verb}`, tone: 'active', action: { kind: 'proposal', proposal: prop } }
  }
  return { label: '한 번의 조정으론 전원이 안 되는 시간이에요 — 다른 시간을 골라보세요', tone: 'muted' }
}

function roomFooter(room: Room, slot: Slot, declined: boolean, optionalIds: string[]): PaneFooter {
  const booking = bookingAt(room, slot)
  if (!booking) return { label: '이 시간 바로 사용할 수 있어요', tone: 'muted' }
  if (declined) return { label: '이미 조정이 어려운 시간이에요', tone: 'danger' }
  const roomProp = roomProposalFor(room, slot, optionalIds)
  if (roomProp) return { label: `${booking.by}에 회의실 사용 요청`, tone: 'active', action: { kind: 'proposal', proposal: roomProp } }
  return { label: '이 예약은 옮기기 어려워요 — 다른 회의실을 골라보세요', tone: 'muted' }
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
  const mine: SidePane = { title: '내 캘린더', events: myEvents, highlight: p.slot, highlightInfo: meetingHighlightInfo(state), identity: { kind: 'person', avatar: '나' } }
  const theirIdent = { kind: 'person' as const, avatar: avatarInitial(who?.name ?? '상대') }

  if (p.action === 'moveFlex' && p.movedEventId && p.moveTo) {
    return { day: p.slot.day, panes: [mine, {
      title: `${who?.name} 캘린더`, events: theirReal, highlight: p.slot, markEventId: p.movedEventId, markMode: 'requestable', identity: theirIdent,
    }] }
  }
  if (p.action === 'concedeSoft') {
    const softBlock: CalEvent = { id: 'soft-mark', ownerId: p.whoId, day: p.slot.day, startHour: 13, endHour: 14, title: '평소 점심 직후 회피', kind: 'flex' }
    return { day: p.slot.day, panes: [mine, { title: `${who?.name} 캘린더`, events: [...theirReal, softBlock], highlight: p.slot, markEventId: 'soft-mark', markMode: 'requestable', identity: theirIdent }] }
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
        identity: { kind: 'room', badge: room ? roomBadge(room) : '룸' },
      }],
    }
  }
  // dropOptional: 그 시간에 겹친 상대 일정을 불참 근거로 표시
  const conflict = theirReal.find((e) => e.day === p.slot.day && p.slot.hour >= e.startHour && p.slot.hour < e.endHour)
  return { day: p.slot.day, panes: [mine, { title: `${who?.name} 캘린더`, events: theirReal, highlight: p.slot, markEventId: conflict?.id ?? null, markMode: 'requestable', identity: theirIdent }] }
}

export type Dispatch = React.Dispatch<Action>
