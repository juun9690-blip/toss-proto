import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { Attendee, AttendeeResponse, CalEvent, ConfirmedMeeting, Day, Level, MeetingDraft, Proposal, Role, Room, Screen, Slot } from './types'
import { DAYS, HOURS } from './types'
import { ATTENDEES, EVENTS, DEFAULT_DRAFT, ROOMS } from './data/mock'
import {
  generateProposals,
  rankCandidates,
  estimateImportance,
  roomEvents,
  bookingAt,
  roomBookingId,
  resolveSlot,
  resolveBlockerFor,
  teamAvailability,
  availableRooms,
  recommendRoom,
  moveTargets,
  rankMoveTargets,
  sameSlot,
  slotCost,
  compareSlotCost,
  allSlots,
  roomProposalFor,
  findBestSlot,
  rankSlotCosts,
  eventsForScheduling,
  type SlotCost,
} from './logic/scheduling'
import CalendarPane, { type SplitData, type SidePane, type PaneActionType, type PaneFooter } from './components/CalendarPane'
import type { CalcCell, Ghost, HighlightInfo, InlineRecommend, MarkMode } from './components/WeekGrid'
import type { EventTone, MeetingVisualStatusMap } from './components/calendarEvents'
import SetupScreen from './screens/SetupScreen'
import CreateScreen from './screens/CreateScreen'
import AttendeesScreen from './screens/AttendeesScreen'
import CandidatesScreen from './screens/CandidatesScreen'
import RevealScreen from './screens/RevealScreen'
import RequestingScreen from './screens/RequestingScreen'
import RespondScreen from './screens/RespondScreen'
import ConfirmScreen from './screens/ConfirmScreen'
import tossScheduleLogo from './assets/toss-schedule-logo.png'

const MY_ID = 'me'
const GITHUB_REPO_URL = 'https://github.com/juun9690-blip/toss-proto'
export type RecMode = 'card' | 'marker' | 'both'
export type RecommendHover = 'card' | 'marker' | null

// 화면 진행 순서 — 전환 방향(앞/뒤) 판별용
const SCREEN_ORDER: Screen[] = ['SETUP', 'CREATE', 'ATTENDEES', 'CANDIDATES', 'REVEAL', 'REQUESTING', 'RESPOND', 'CONFIRM']

function usePrevious<T>(value: T): T | undefined {
  const ref = useRef<T>()
  useEffect(() => {
    ref.current = value
  }, [value])
  return ref.current
}

function initialRecMode(): RecMode {
  const value = new URLSearchParams(window.location.search).get('rec')
  return value === 'card' || value === 'marker' ? value : 'both'
}

function inlineRecommendLabel(best: SlotCost): string {
  switch (best.tier) {
    case 'T0':
    case 'T0b':
      return '모두 가능한 시간'
    case 'T1':
      return '1명만 조정하면 돼요'
    case 'T2':
      return '회의실만 조정하면 돼요'
    default:
      return best.roomAsk ? '일정·회의실 조정' : '1명만 조정하면 돼요'
  }
}

// 추천 시간 = best 하나만이 아니라 '부담이 적은 시간' 전부. 전 슬롯을 비용순으로 훑어
// (feasible·필참 조정 ≤1, T4 제외) 낮은 비용부터 고르되, 살아있는 슬롯이 수십 개라 도배되지 않도록
// best + 상위 4개 = 5개로 캡한다. 좌측 카드 목록과 캘린더 마커가 이 '한 소스'를 공유해 항상 일치한다.
export function recommendedSlotCosts(state: State, best: SlotCost | null): SlotCost[] {
  if (!best) return []
  const schedulingEvents = eventsForScheduling(state.attendees, state.events)
  const needsRoom = state.draft.mode === 'inperson'
  const ctx = { askedIds: askedIdsOf(state) } // best·마커·목록·연출이 같은 컨텍스트를 공유
  const ranked = allSlots()
    .map((slot) => slotCost(state.attendees, schedulingEvents, state.rooms, slot, state.attendees.length, needsRoom, ctx))
    .filter((cost) => cost.feasible && cost.personAsks <= 1 && cost.tier !== 'T4'
      && !hostHasDisplayedEvent(state, cost.slot)
      && !slotAdjustmentDeclined(state, cost.slot, schedulingEvents)) // 거절된 시간 제외
    .sort(compareSlotCost)
  // best는 항상 맨 앞(primary) — 캘린더 컬럼 스캔·펄스를 이끈다. 나머지 저비용 슬롯이 뒤따른다.
  const others = ranked.filter((cost) => !sameSlot(cost.slot, best.slot)).slice(0, 4)
  return [best, ...others].filter((cost) => !hostHasDisplayedEvent(state, cost.slot))
}

function buildInlineRecommendations(state: State, best: SlotCost | null): InlineRecommend[] | null {
  if (!best) return null
  const current = currentCandidatesSlot(state) ?? best.slot
  const ranked = recommendedSlotCosts(state, best)
  const currentIsRecommended = state.slotPicked && ranked.some((cost) => sameSlot(cost.slot, current))
  const suppressPrimary = currentIsRecommended || (state.slotPicked && hostHasDisplayedEvent(state, current))
  return ranked
    .map((cost, index) => ({ cost, index }))
    // 이미 그 시간을 보고 있으면(slotPicked) 마커는 '다른' 대안만 — 좌측 카드와 같은 규칙.
    .filter(({ cost }) => !(state.slotPicked && sameSlot(cost.slot, current)))
    .map(({ cost, index }) => ({
      id: `${cost.slot.day}-${cost.slot.hour}`,
      slot: cost.slot,
      label: inlineRecommendLabel(cost),
      tone: index === 0 && !suppressPrimary ? 'primary' as const : 'secondary' as const,
      absorbed: !!state.selectedSlot && sameSlot(state.selectedSlot, cost.slot),
      dIn: Math.round(cellJitter(cost.slot.day, cost.slot.hour, 17) * calcTimeline(state.draft.mode === 'inperson').layEnd), // 소거 박스와 같은 리듬으로 깔림
    }))
}

// ── 계산 연출(후보 소거) 셀 계산 — 로직(rankSlotCosts/slotCost)을 각색 없이 연기한다 ──
// 내 일정이 없는 빈칸 전부에 후보 박스를 깔고, 비용 사다리 순서로 소거한다:
//   W1(사람 충돌·정원) → W2(회의실 없음) → W3(잔여) → 생존 1칸(best) → 마커로 착지.
// 웨이브 '사이' 순서(사람→회의실)는 서사라 유지하되, 웨이브 '안'은 정직한 월→금 대신
// 결정적 지터로 흩뿌려(popcorn) 더 다이나믹하게. 지연은 전부 순수 계산 → WeekGrid엔 ms만 전달.
function cellJitter(day: string, hour: number, seed: number): number {
  // FNV-1a + murmur3 finalizer(아발란치). 인접 입력(같은 요일 연속 시각)도 완전히 다른 값이 나오게 —
  // 이게 없으면 마지막 글자만 다른 '화:13/화:14/화:15'가 거의 같은 값이라 순차로 사라졌다.
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) >>> 0
  const s = `${day}:${hour}`
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  h ^= h >>> 16
  h = Math.imul(h, 0x85ebca6b) >>> 0
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35) >>> 0
  h ^= h >>> 16
  return (h >>> 0) / 4294967296 // 렌더마다 동일(Math.random 금지) — 박스가 재배치되지 않게
}
// 계산 연출 타임라인 — 사이드바 멘트(CandidatesScreen)와 캘린더 소거 웨이브(buildCalcCells)가
// '같은 시각'을 쓴다. 소거가 사이드바 전 구간을 채우도록(캘린더가 먼저 끝나지 않게) 웨이브 창을 길게.
// 칸이 가장 많은 W1(사람 충돌)을 넓게 펼쳐 하나씩 흩어져 사라지게 한다. 온라인은 회의실 구간(W2) 없이 단축.
export interface CalcTimeline {
  layEnd: number // 후보 박스 '깔기'가 끝나는 시각 — 이 안에서 균등 분배로 하나씩 채워진다
  waves: Record<1 | 2 | 3, [number, number]> // 각 웨이브 소거 창 [시작, 끝] — 이 안에서 흩어져 소거
  found: number // '찾았어요' 멘트 시점(사이드바 배너 전용 — 캘린더 웨이브와 무관)
  ready: number // 마커 착지 = 연출 종료
}
export function calcTimeline(needsRoom: boolean): CalcTimeline {
  // 깔기(0~layEnd) 뒤 '모두 후보' 한 박자 → W1 소거. layEnd + 깔기시간(200) < W1 시작이어야 겹치지 않음.
  return needsRoom
    ? { layEnd: 800, waves: { 1: [1080, 1960], 2: [2010, 2340], 3: [2380, 2560] }, found: 2450, ready: 2940 }
    : { layEnd: 800, waves: { 1: [1080, 1560], 2: [1610, 1610], 3: [1610, 1940] }, found: 1950, ready: 2300 }
}
function buildCalcCells(state: State, best: SlotCost | null): CalcCell[] {
  const needsRoom = state.draft.mode === 'inperson'
  const schedulingEvents = eventsForScheduling(state.attendees, state.events)
  const t = calcTimeline(needsRoom)
  // 추천 세트(best + 부담 적은 대안들)는 소거하지 않는다 — 그 자리 마커가 박스→마커로 모프한다.
  const recSet = new Set(recommendedSlotCosts(state, best).map((c) => `${c.slot.day}-${c.slot.hour}`))
  // 1) 소거 대상만 골라 웨이브 분류(W1 사람 충돌 → W2 회의실 없음 → W3 잔여)
  const byWave: Record<1 | 2 | 3, { day: Day; hour: number }[]> = { 1: [], 2: [], 3: [] }
  const all: { day: Day; hour: number }[] = []
  for (const day of DAYS) {
    for (const hour of HOURS) {
      const slot: Slot = { day, hour }
      if (hostHasDisplayedEvent(state, slot)) continue // 내 일정 칸 제외
      if (recSet.has(`${day}-${hour}`)) continue // 추천 세트는 살아남음
      const c = slotCost(state.attendees, schedulingEvents, state.rooms, slot, state.attendees.length, needsRoom)
      byWave[(c.personAsks > 0 || !c.feasible) ? 1 : c.roomAsk ? 2 : 3].push({ day, hour })
      all.push({ day, hour })
    }
  }
  // 창 [start,end]에 흩뿌리는 헬퍼. evenWeight로 '균등(안겹침) ↔ 랜덤(제각각)' 비율을 조절한다.
  //  랜덤 성분(1-evenWeight)이 클수록 위치와 무관하게 제멋대로 사라져 '상단부터' 같은 패턴이 사라진다.
  const scatter = (arr: { day: Day; hour: number }[], start: number, end: number, orderSeed: number, randSeed: number, evenWeight: number) => {
    const sorted = arr.slice().sort((a, b) => cellJitter(a.day, a.hour, orderSeed) - cellJitter(b.day, b.hour, orderSeed))
    const span = Math.max(0, end - start)
    const n = sorted.length
    const at = new Map<string, number>()
    sorted.forEach(({ day, hour }, i) => {
      const evenFrac = n <= 1 ? 0.5 : i / (n - 1)            // 겹침 방지용 균등 성분
      const randFrac = cellJitter(day, hour, randSeed)        // 위치 무관 랜덤 성분
      const frac = evenWeight * evenFrac + (1 - evenWeight) * randFrac
      at.set(`${day}-${hour}`, Math.round(start + frac * span))
    })
    return at
  }
  // 2) 깔기(lay-in): 부드럽게 채우되(균등 60%) 순차 아니게 흩어(랜덤 40%).
  const dInAt = scatter(all, 0, t.layEnd, 17, 41, 0.6)
  // 3) 소거: 대부분 랜덤(균등 25%)으로 제각각 흩어져 사라진다 — 상단부터 같은 순서감 제거.
  const cells: CalcCell[] = []
  for (const w of [1, 2, 3] as const) {
    const [ws, we] = t.waves[w]
    const dOutAt = scatter(byWave[w], ws, we, 91, 71, 0.25)
    for (const { day, hour } of byWave[w]) {
      cells.push({
        day, hour,
        dIn: dInAt.get(`${day}-${hour}`) ?? 0,
        dOut: dOutAt.get(`${day}-${hour}`) ?? ws,
        outDur: 240 + Math.round(cellJitter(day, hour, 53) * 260), // 사라지는 속도 240~500ms 제각각
      })
    }
  }
  return cells
}

function hostHasDisplayedEvent(state: State, slot: Slot): boolean {
  const hostId = state.attendees.find((attendee) => attendee.role === 'host')?.id ?? MY_ID
  return state.events.some((event) =>
    event.ownerId === hostId &&
    event.day === slot.day &&
    slot.hour >= event.startHour &&
    slot.hour < event.endHour,
  )
}

// 그 슬롯의 '단건 조정'이 이미 거절됐는지 — 거절된 시간은 추천에서 뺀다(계속 그 시간을 밀지 않게).
// (정하늘이 수15 조정을 거절하면 수15는 더 이상 best/추천 목록에 안 뜬다)
function slotAdjustmentDeclined(state: State, slot: Slot, schedulingEvents: CalEvent[]): boolean {
  const fix = resolveSlot(state.attendees, schedulingEvents, slot)
  return !!fix && state.declinedIds.includes(proposalKey(fix))
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
  confirmedMeetings: ConfirmedMeeting[]
  customDurationPicking: boolean
  declineSeq: number          // 거절 횟수 — 변화(증가)를 감지해 '거절 반영 모먼트' 연출을 1회 재생
  lastDeclinedWhoId: string | null // 방금 거절한 대상(attendee id면 사람 거절, 팀명이면 회의실 거절)
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
  confirmedMeetings: [],
  customDurationPicking: false,
  declineSeq: 0,
  lastDeclinedWhoId: null,
}

type Action =
  | { type: 'GOTO'; screen: Screen }
  | { type: 'SET_DRAFT'; draft: MeetingDraft }
  | { type: 'TOGGLE_ROLE'; id: string }
  | { type: 'SET_IMPORTANCE'; level: Level | null }
  | { type: 'SELECT_SLOT'; slot: Slot; durationHours?: number }
  | { type: 'SET_CUSTOM_DURATION_PICKING'; value: boolean }
  | { type: 'PICK_MOVE_DEST'; slot: Slot }
  | { type: 'PREVIEW_CONFLICT'; attendeeId: string }
  | { type: 'PREVIEW_ROOM'; roomName: string }
  | { type: 'CLOSE_PREVIEW'; which: 'person' | 'room' | 'all' }
  | { type: 'COMPUTE' }
  | { type: 'CONFIRM_REQUIRED_ONLY'; slot: Slot; excludedId: string | null }
  | { type: 'SELECT_PROPOSAL'; proposal: Proposal }
  | { type: 'SET_REQUEST_MESSAGE'; message: string }
  | { type: 'SEND_REQUEST' }
  | { type: 'ACCEPT' }
  | { type: 'DECLINE' }
  | { type: 'PROPOSE_ALT' }
  | { type: 'GO_HOME' }
  | { type: 'RESPONSE_ARRIVED'; meetingId: string; attendeeId: string }
  | { type: 'RESTART' }

// ── 파생값 ──
export function requiredCount(attendees: Attendee[]): number {
  return attendees.filter((a) => a.role !== 'optional').length
}
export function effectiveImportance(state: State): { level: Level; reason: string; auto: Level; overridden: boolean } {
  const auto = estimateImportance(requiredCount(state.attendees))
  if (state.importanceOverride)
    return { level: state.importanceOverride, reason: '직접 설정', auto: auto.level, overridden: true }
  return { level: auto.level, reason: auto.reason, auto: auto.level, overridden: false }
}

export function proposalKey(p: Proposal): string {
  return proposalTargetKey(p.action, p.whoId, p.roomName ?? '', p.slot)
}

// 계약: 'action|whoId|room|day|hour' — whoId가 2번째 필드(askedIdsOf가 이 위치에 의존).
function proposalTargetKey(action: Proposal['action'], whoId: string, roomName: string, slot: Slot): string {
  return [action, whoId, roomName, slot.day, slot.hour].join('|')
}

// 이번 조율에서 이미 거절·양보(수락)한 사람 집합 — 미시 비용 M1(재요청 회피)용.
// 랭킹의 모든 소스(best 카드·마커·대안 목록·계산 연출)가 이 한 컨텍스트를 공유해야 한다(소스 분기 금지).
// 회의실 거절 키의 whoId는 팀명이라 attendee id와 불일치 → 사람 키에 영향 없음. raw 제안 id('p3')는 '|' 없어 스킵.
export function askedIdsOf(state: State): Set<string> {
  const ids = new Set<string>()
  for (const k of [...state.declinedIds, ...state.acceptedKeys]) {
    const who = k.split('|')[1]
    if (who) ids.add(who)
  }
  return ids
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
  const schedulingEvents = eventsForScheduling(invited, events)
  const acceptedPersonFix = resolveSlot(invited, schedulingEvents, slot)
  const requiredReady = teamAvailability(invited, schedulingEvents, slot).every((a) => {
    if (a.ok || a.att.role === 'optional') return true
    return !!acceptedPersonFix &&
      acceptedPersonFix.whoId === a.att.id &&
      acceptedKeys.includes(proposalKey(acceptedPersonFix))
  })
  const freeRooms = availableRooms(rooms, slot, invited.length)
  const selectedRoomOk = freeRooms.some((r) => r.name === location)
  // 온라인·둘 다 가능은 회의실이 하드 게이트가 아니다(온라인 폴백) → roomReady 항상 true
  const needsRoom = state.draft.mode !== 'online' && state.draft.mode !== 'either'
  const roomReady = !needsRoom || selectedRoomOk || freeRooms.length > 0
  return requiredReady && roomReady
}

function resolvedLocation(state: State, slot: Slot, rooms: Room[], location: string, excludedId: string | null): string {
  if (state.draft.mode === 'online') return '온라인'
  const invited = excludedId ? state.attendees.filter((a) => a.id !== excludedId) : state.attendees
  const freeRooms = availableRooms(rooms, slot, invited.length)
  if (freeRooms.some((r) => r.name === location)) return location
  const rec = recommendRoom(rooms, slot, invited.length, location)
  if (rec) return rec.name
  return state.draft.mode === 'either' ? '온라인' : location // 둘 다 가능인데 빈 방 없으면 온라인 폴백
}

function finalizeMeeting(
  state: State,
  slot: Slot,
  events: CalEvent[],
  location: string,
  excludedId: string | null,
  acceptedKeys: string[],
  acceptedProposal?: Proposal,
): { events: CalEvent[]; confirmedMeetings: ConfirmedMeeting[] } {
  const meetingId = `m${state.confirmedMeetings.length + 1}`
  const title = state.draft.title.trim() || '회의'
  const requestNotes = acceptedRequestNotes(state, slot, acceptedKeys, acceptedProposal)
  const responses: AttendeeResponse[] = state.attendees
    .filter((attendee) => attendee.id !== MY_ID)
    .map((attendee) => {
      if (attendee.id === excludedId) return { attendeeId: attendee.id, status: 'excluded' as const }
      const note = requestNotes.get(attendee.id)
      if (note) return { attendeeId: attendee.id, status: 'confirmed' as const, via: 'request' as const, note }
      return { attendeeId: attendee.id, status: 'pending' as const, via: 'share' as const }
    })
  const denominator = responses.filter((response) => response.status !== 'excluded').length
  const duration = state.draft.durationHours ?? 1
  const meetingEvents: CalEvent[] = state.attendees
    .filter((attendee) => attendee.id !== excludedId)
    .map((attendee) => ({
      id: `mtg-${meetingId}-${attendee.id}`,
      ownerId: attendee.id,
      day: slot.day,
      startHour: slot.hour,
      endHour: slot.hour + duration,
      title,
      kind: 'meeting' as const,
    }))

  if (denominator === 0) return { events: [...events, ...meetingEvents], confirmedMeetings: state.confirmedMeetings }

  const meeting: ConfirmedMeeting = {
    id: meetingId,
    title,
    slot,
    location,
    responses,
    dismissed: false,
    createdAt: Date.now(),
  }
  return { events: [...events, ...meetingEvents], confirmedMeetings: [...state.confirmedMeetings, meeting] }
}

function acceptedRequestNotes(
  state: State,
  slot: Slot,
  acceptedKeys: string[],
  acceptedProposal?: Proposal,
): Map<string, string> {
  const proposals = new Map<string, Proposal>()
  for (const proposal of state.proposals) proposals.set(proposalKey(proposal), proposal)
  if (acceptedProposal) proposals.set(proposalKey(acceptedProposal), acceptedProposal)

  const notes = new Map<string, string>()
  for (const key of acceptedKeys) {
    const proposal = proposals.get(key)
    if (!proposal || !sameSlot(proposal.slot, slot)) continue
    if (proposal.action === 'moveFlex') notes.set(proposal.whoId, '개인 일정 조정 후 참석해요')
    if (proposal.action === 'concedeSoft') notes.set(proposal.whoId, '평소 피하는 시간인데 참석해요')
  }
  return notes
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
      // 주장의 전제(필참 구성)가 바뀌면 주장은 무효 — 자동 추정으로 복귀
      return { ...state, attendees, importanceOverride: null }
    }
    case 'SET_IMPORTANCE':
      return { ...state, importanceOverride: action.level }
    case 'SELECT_SLOT':
      return {
        ...state,
        selectedSlot: action.slot,
        slotPicked: true,
        customDurationPicking: action.durationHours ? true : state.customDurationPicking,
        draft: action.durationHours ? { ...state.draft, durationHours: action.durationHours } : state.draft,
        conflictFocusId: null,
        roomFocusName: null,
      }
    case 'SET_CUSTOM_DURATION_PICKING':
      return { ...state, customDurationPicking: action.value }
    case 'PICK_MOVE_DEST':
      return { ...state, receiverMoveTo: action.slot }
    case 'PREVIEW_CONFLICT':
      return { ...state, conflictFocusId: state.conflictFocusId === action.attendeeId ? null : action.attendeeId }
    case 'PREVIEW_ROOM':
      return { ...state, roomFocusName: state.roomFocusName === action.roomName ? null : action.roomName }
    case 'CLOSE_PREVIEW':
      // 사람/회의실 나란히 보기를 닫고 주별 캘린더로 복귀. which로 한쪽만 또는 둘 다 닫는다.
      return {
        ...state,
        conflictFocusId: action.which === 'room' ? state.conflictFocusId : null,
        roomFocusName: action.which === 'person' ? state.roomFocusName : null,
      }
    case 'COMPUTE': {
      const schedulingEvents = eventsForScheduling(state.attendees, state.events)
      const proposals = generateProposals(state.attendees, schedulingEvents)
      // 시간을 안 골랐으면 조정 후보에 먼저 머무르고, 완벽한 시간은 사용자가 카드로 직접 선택한다.
      const blind = state.selectedSlot == null
      const selectedSlot = blind ? null : state.selectedSlot ?? proposals[0]?.slot ?? findBestSlot(state.attendees, schedulingEvents, state.rooms, state.attendees.length, state.draft.mode === 'inperson', { askedIds: askedIdsOf(state) })?.slot ?? { day: '화' as const, hour: 15 }
      return { ...state, proposals, selectedSlot, slotPicked: !blind, screen: 'CANDIDATES' }
    }
    case 'CONFIRM_REQUIRED_ONLY': {
      // 패널에서 바로 확정해도 유효한 회의실이 잡히도록 위치를 해석한다.
      const location = resolvedLocation(state, action.slot, state.rooms, state.draft.location, action.excludedId)
      const finalized = finalizeMeeting(state, action.slot, state.events, location, action.excludedId, state.acceptedKeys)
      return { ...state, draft: { ...state.draft, location }, events: finalized.events, confirmedMeetings: finalized.confirmedMeetings, confirmedSlot: action.slot, excludedId: action.excludedId, movedNote: null, screen: 'CONFIRM' }
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
        movedNote = `${attendeeName(state, p.whoId)} 님이 해당 시간 일정을 조정했어요.`
        excludedId = p.excludeIds?.[0] ?? null // 선택 참석 동시 차단자는 함께 제외(감사 P2)
      } else if (p.action === 'concedeSoft') {
        movedNote = `${attendeeName(state, p.whoId)} 님이 이번 회의 참석 요청을 수락했습니다.`
        excludedId = p.excludeIds?.[0] ?? null // 선택 참석 동시 차단자는 함께 제외(감사 P2)
      } else if (p.action === 'dropOptional') {
        excludedId = p.whoId
        movedNote = `${attendeeName(state, p.whoId)} 님(선택 참석)은 이번 회의에서 제외됩니다.`
      } else if (p.action === 'moveRoomBooking' && p.roomName && (state.receiverMoveTo || p.moveTo)) {
        const dest = state.receiverMoveTo ?? p.moveTo!  // 수신 팀이 직접 고른 자리 우선(사람 이동과 동일)
        rooms = state.rooms.map((r) => r.name === p.roomName
          ? { ...r, bookings: r.bookings.map((b) => (b.day === p.slot.day && b.hour === p.slot.hour) ? { ...b, day: dest.day, hour: dest.hour } : b) }
          : r,
        )
        location = p.roomName
        excludedId = p.excludeIds?.[0] ?? null
        movedNote = `${p.whoId}이 ${p.roomName} 예약을 옮겨 회의실을 확보했어요.`
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
      return {
        ...base,
        confirmedSlot: null,
        selectedSlot: p.slot,
        slotPicked: true,
        conflictFocusId: p.action === 'moveRoomBooking' ? null : p.whoId,
        roomFocusName: p.action === 'moveRoomBooking' ? p.roomName ?? null : null,
        screen: 'CANDIDATES',
      }
    }
    case 'DECLINE': {
      const declinedIds = state.selected
        ? [...state.declinedIds, state.selected.id, proposalKey(state.selected)]
        : state.declinedIds
      return {
        ...state, declinedIds, selected: null, requestMessage: '', screen: 'CANDIDATES',
        declineSeq: state.declineSeq + 1, lastDeclinedWhoId: state.selected?.whoId ?? null,
      }
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
        selectedSlot: null, // 거절한 시간을 하이라이트로 남겨두지 않는다 — 다른 시간을 새로 고르게
        conflictFocusId: null,
        roomFocusName: null,
        screen: 'CANDIDATES',
        // 거절 반영 모먼트 트리거 — 복귀 1회 연출을 재생하도록 seq 증가 + 거절 대상 기록
        declineSeq: state.declineSeq + 1,
        lastDeclinedWhoId: state.selected?.whoId ?? null,
      }
    }
    case 'GO_HOME':
      return {
        ...initial,
        events: state.events,
        rooms: state.rooms,
        confirmedMeetings: state.confirmedMeetings,
        screen: 'SETUP',
      }
    case 'RESPONSE_ARRIVED':
      return {
        ...state,
        confirmedMeetings: state.confirmedMeetings.map((meeting) => {
          if (meeting.id !== action.meetingId || meeting.dismissed) return meeting
          return {
            ...meeting,
            responses: meeting.responses.map((response) =>
              response.attendeeId === action.attendeeId && response.status === 'pending'
                ? { ...response, status: 'confirmed' as const }
                : response,
            ),
          }
        }),
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
  const scheduledResponses = useRef<Set<string>>(new Set())
  const responseTimers = useRef<number[]>([])
  // 진행 순서상 뒤로 가면 back, 아니면 fwd (초기 진입도 fwd)
  const dir =
    prevScreen && SCREEN_ORDER.indexOf(state.screen) < SCREEN_ORDER.indexOf(prevScreen) ? 'back' : 'fwd'
  const [handoffText, setHandoffText] = useState<string | null>(null)
  const [recMode] = useState<RecMode>(() => initialRecMode())
  const [inlineScanPlaying, setInlineScanPlaying] = useState(false)
  const [inlineRecommendVisible, setInlineRecommendVisible] = useState(false)
  const [recommendHover, setRecommendHover] = useState<RecommendHover>(null)
  // 추천 목록을 '토글로 다시 열' 때마다 증가 → 캘린더 마커를 리마운트해 등장 인터랙션을 재생한다.
  // (0 = 첫 계산 연출(morph)이 담당 — 그땐 마커가 morphing으로 뜨므로 별도 등장 없음)
  const [markerRevealKey, setMarkerRevealKey] = useState(0)
  const selectedSlotKey = state.selectedSlot ? `${state.selectedSlot.day}-${state.selectedSlot.hour}` : ''

  useEffect(() => {
    return () => {
      responseTimers.current.forEach((timer) => window.clearTimeout(timer))
    }
  }, [])

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

  useEffect(() => {
    if (state.screen !== 'CANDIDATES') {
      setInlineScanPlaying(false)
      setInlineRecommendVisible(false)
    }
  }, [state.screen])

  useEffect(() => {
    setInlineScanPlaying(false)
    setInlineRecommendVisible(false)
  }, [selectedSlotKey])

  useEffect(() => {
    for (const meeting of state.confirmedMeetings) {
      if (meeting.dismissed) continue
      const pending = meeting.responses.filter((response) => response.status === 'pending')
      pending.forEach((response, index) => {
        const key = `${meeting.id}:${response.attendeeId}`
        if (scheduledResponses.current.has(key)) return
        scheduledResponses.current.add(key)
        const timer = window.setTimeout(() => {
          dispatch({ type: 'RESPONSE_ARRIVED', meetingId: meeting.id, attendeeId: response.attendeeId })
        }, 3000 + index * 3000)
        responseTimers.current.push(timer)
      })
    }
  }, [state.confirmedMeetings])

  const schedulingEvents = useMemo(() => eventsForScheduling(state.attendees, state.events), [state.attendees, state.events])
  const candidates = useMemo(() => rankCandidates(state.attendees, schedulingEvents), [state.attendees, schedulingEvents])
  // 추천 우선도 = 비용 사다리(로직 계획 §0~2). 필참 수로 매직 on/off를 분기하지 않고, 항상 최소
  // 비용 티어 1건을 낸다. 필참이 적으면 asks 0(매직), 많으면 asks 1(최소 조정)으로 데이터에서 창발.
  // 슬롯이 소비되면(2막) 차순위로 자동 갱신, T4만 남으면 null(카드 미표시)이 된다.
  const best = useMemo(() => {
    // 비용 사다리 최소 티어부터 훑되, '조정이 거절된 시간'은 건너뛴다 — 거절된 시간을 계속 추천하지 않게.
    // 미시 컨텍스트(거절·양보 이력)를 넘겨 동률 안에서도 다른 사람 슬롯으로 자동 점프하게 한다.
    const ranked = rankSlotCosts(state.attendees, schedulingEvents, state.rooms, state.attendees.length, state.draft.mode === 'inperson', { askedIds: askedIdsOf(state) })
    return ranked.find((c) => !slotAdjustmentDeclined(state, c.slot, schedulingEvents)) ?? null
  }, [state, schedulingEvents])
  const liveProposals = state.proposals.filter((p) => !isDeclined(state, p))
  const cal = mainCalendarView(state, best, recMode, inlineRecommendVisible)
  // 계산 연출(후보 소거)은 CANDIDATES·주간·비분할·계산 중일 때만 캘린더에 얹는다.
  const calcCells = state.screen === 'CANDIDATES' && recMode !== 'card' && inlineScanPlaying && !cal.split
    ? buildCalcCells(state, best)
    : null

  return (
    <div className="app-shell">
      <header className="topbar">
        <button type="button" className="brand" onClick={() => dispatch({ type: 'GO_HOME' })}>
          <img className="mk" src={tossScheduleLogo} alt="" /> 일정 조율
        </button>
        <a className={`github-link ${state.confirmedMeetings.length > 0 ? 'emphasized' : ''}`} href={GITHUB_REPO_URL} target="_blank" rel="noreferrer" aria-label="GitHub 저장소 열기">
          <svg className="github-mark" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56v-2.14c-3.2.7-3.88-1.36-3.88-1.36-.52-1.32-1.27-1.67-1.27-1.67-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.75 2.68 1.24 3.33.95.1-.74.4-1.24.72-1.53-2.55-.29-5.23-1.28-5.23-5.68 0-1.25.45-2.28 1.18-3.08-.12-.29-.51-1.46.11-3.04 0 0 .96-.31 3.15 1.17.91-.25 1.89-.38 2.86-.38.97 0 1.95.13 2.86.38 2.19-1.48 3.15-1.17 3.15-1.17.62 1.58.23 2.75.11 3.04.73.8 1.18 1.83 1.18 3.08 0 4.42-2.69 5.38-5.25 5.67.41.35.77 1.05.77 2.12v3.15c0 .31.21.67.8.56A11.51 11.51 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
          </svg>
          <span>GitHub</span>
        </a>
      </header>
      <div className="layout">
        <aside className="sidebar">
          {/* key 변경 → 리마운트 → CSS 입장 애니메이션 자동 재생 (fwd/back 방향) */}
          <div key={state.screen} className={`screen-enter ${dir}`}>
            {state.screen === 'SETUP' && <SetupScreen state={state} dispatch={dispatch} />}
            {state.screen === 'CREATE' && <CreateScreen state={state} dispatch={dispatch} />}
            {state.screen === 'ATTENDEES' && <AttendeesScreen state={state} dispatch={dispatch} />}
            {state.screen === 'CANDIDATES' && (
              <CandidatesScreen
                state={state}
                dispatch={dispatch}
                candidates={candidates}
                proposals={liveProposals}
                best={best}
                recMode={recMode}
                recommendHover={recommendHover}
                onRecommendHover={setRecommendHover}
                onInlineScanChange={setInlineScanPlaying}
                onInlineRecommendVisibilityChange={setInlineRecommendVisible}
                onMarkerReveal={() => setMarkerRevealKey((k) => k + 1)}
              />
            )}
            {state.screen === 'REVEAL' && <RevealScreen state={state} dispatch={dispatch} best={best} />}
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
            eventTone={cal.eventTone}
            meetingStatuses={cal.meetingStatuses}
            highlightDurationHours={state.draft.durationHours ?? 1}
            durationPickMode={state.screen === 'CREATE' && state.customDurationPicking && state.draft.durationHours === null}
            candidates={cal.candidates}
            candidateDurationHours={cal.candidateDurationHours}
            recommends={cal.recommends?.map((item) => ({ ...item, pulse: item.tone === 'primary' && recommendHover === 'card' })) ?? null}
            calcCells={calcCells}
            markerRevealKey={markerRevealKey}
            onRecommendHover={setRecommendHover}
            onPickSlot={
              state.screen === 'RESPOND' && (state.selected?.action === 'moveFlex' || state.selected?.action === 'moveRoomBooking')
                ? (slot) => dispatch({ type: 'PICK_MOVE_DEST', slot })
                : state.screen === 'CANDIDATES'
                  // CANDIDATES에서만 캘린더로 시간을 고른다 — 그 전 화면(SETUP·ATTENDEES 등)에서
                  // 미리 시간을 선점하면 blind 진입이 깨져 '부담이 가장 적은 시간' 추천 로직을 못 보여준다.
                  ? (slot, durationHours) => {
                    setInlineScanPlaying(false)
                    dispatch({ type: 'SELECT_SLOT', slot, durationHours })
                  }
                  // CREATE는 '+'로 연 커스텀 길이 드래그일 때만(회의 길이 지정 도구) 캘린더를 받는다.
                  : state.screen === 'CREATE' && state.customDurationPicking && state.draft.durationHours === null
                    ? (slot, durationHours) => dispatch({ type: 'SELECT_SLOT', slot, durationHours })
                    : undefined
            }
            onPaneAction={(a: PaneActionType) => {
              // 패널=버튼: 보고 있는 상대에게 바로 요청/확정 (UT §2)
              if (a.kind === 'proposal') dispatch({ type: 'SELECT_PROPOSAL', proposal: a.proposal })
              else dispatch({ type: 'CONFIRM_REQUIRED_ONLY', slot: a.slot, excludedId: a.excludedId })
            }}
            onClosePane={(which) => dispatch({ type: 'CLOSE_PREVIEW', which })}
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
  candidateDurationHours?: number // 후보 칸 높이 = 옮길 일정의 길이(2시간이면 2칸)
  split?: SplitData | null
  title?: string
  rangeText?: string
  eventTone?: EventTone
  meetingStatuses?: MeetingVisualStatusMap
  recommends?: InlineRecommend[] | null
}

function mainCalendarView(state: State, best: SlotCost | null, recMode: RecMode, inlineRecommendVisible: boolean): CalView {
  const myEvents = state.events.filter((e) => e.ownerId === MY_ID)
  const highlightInfo = meetingHighlightInfo(state)
  const base: CalView = { events: myEvents, highlight: null, highlightInfo, markEventId: null, meetingStatuses: buildMeetingStatuses(state) }

  switch (state.screen) {
    case 'SETUP': {
      return { ...base, highlight: state.selectedSlot, eventTone: state.selectedSlot ? 'muted' : 'colorful' }
    }
    case 'CREATE':
      return { ...base, highlight: state.selectedSlot }
    case 'ATTENDEES':
      return { ...base, highlight: state.selectedSlot }
    case 'CANDIDATES': {
      const previewSlot = currentCandidatesSlot(state)
      const preview = previewSlot ? buildCandidatesPreview(state, previewSlot, myEvents) : null
      if (preview) return { ...base, split: preview }
      const recommends = recMode !== 'card' && inlineRecommendVisible ? buildInlineRecommendations(state, best) : null
      return { ...base, highlight: state.selectedSlot, recommends }
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

function currentCandidatesSlot(state: State): Slot | null {
  const liveProposal = state.proposals.find((proposal) => !isDeclined(state, proposal))
  const schedulingEvents = eventsForScheduling(state.attendees, state.events)
  return state.selectedSlot
    ?? liveProposal?.slot
    ?? findBestSlot(
      state.attendees,
      schedulingEvents,
      state.rooms,
      state.attendees.length,
      state.draft.mode === 'inperson',
      { askedIds: askedIdsOf(state) },
    )?.slot
    ?? null
}

function meetingHighlightInfo(state: State): HighlightInfo | null {
  const title = state.draft.title.trim()
  const selectedRequired = state.attendees.some((a) => a.role === 'required')
  const meta = selectedRequired ? `${requiredCount(state.attendees)}명 꼭 참여` : undefined
  if (!title && !meta) return null
  return { title: title || '회의', meta }
}

function buildMeetingStatuses(state: State): MeetingVisualStatusMap {
  const statuses: MeetingVisualStatusMap = {}
  for (const meeting of state.confirmedMeetings) {
    const activeResponses = meeting.responses.filter((response) => response.status !== 'excluded')
    const total = activeResponses.length
    if (total === 0) continue
    const confirmed = activeResponses.filter((response) => response.status === 'confirmed').length
    const status = { confirmed, total, done: confirmed === total }
    for (const attendee of state.attendees) {
      if (meeting.responses.some((response) => response.attendeeId === attendee.id && response.status === 'excluded')) continue
      statuses[`mtg-${meeting.id}-${attendee.id}`] = status
    }
  }
  return statuses
}

function buildRespondCalendar(state: State, p: Proposal): CalView {
  if (p.action === 'moveRoomBooking' && p.roomName) {
    const room = state.rooms.find((r) => r.name === p.roomName)
    const base = {
      events: room ? roomEvents(room) : [],
      highlight: p.slot,
      title: `${p.roomName} 시간표`,
      rangeText: `${p.whoId}에 보이는 요청 화면 · ${p.slot.day} ${p.slot.hour}:00`,
    }
    if (!room) return { ...base, markEventId: p.movedEventId ?? null, markMode: 'requestable' }
    // 사람 이동과 동일: 그 방 예약을 옮길 빈 시간(후보 밴드)을 보여주고, 고르면 예약이 그 자리로 미끄러진다.
    const bookingEvents = roomEvents(room)
    const movedRoomEv = bookingEvents.find((e) => e.id === p.movedEventId)
    const candidates = movedRoomEv ? rankMoveTargets(movedRoomEv, bookingEvents, p.slot).map((t) => t.slot) : []
    const picked = state.receiverMoveTo
    if (movedRoomEv && picked) {
      const movedBk: CalEvent = { ...movedRoomEv, day: picked.day, startHour: picked.hour, endHour: picked.hour + 1 }
      const others = bookingEvents.filter((e) => e.id !== movedRoomEv.id)
      return { ...base, events: [...others, movedBk], markEventId: movedRoomEv.id, markMode: 'movedOk', candidates, candidateDurationHours: 1 }
    }
    return { ...base, markEventId: p.movedEventId ?? null, markMode: 'moveAsk', candidates, candidateDurationHours: 1 }
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
    const targets = ev ? moveTargets(ev, eventsForScheduling(state.attendees, state.events), p.slot) : []
    // 옮길 일정의 길이 — 캘린더는 이 길이를 그대로 그린다(2시간이면 2칸). 크기가 곧 근거.
    const span = ev ? Math.max(1, ev.endHour - ev.startHour) : 1
    // 유효한 시작점은 '전부' 넘긴다(하나도 숨기지 않는다). 고른 뒤에도 그대로 — 11시를 골랐다고
    // 겹치는 10시가 사라지면 다시 못 고른다. 겹침은 WeekGrid가 연속 구간을 하나의
    // '빈 시간대' 밴드로 묶어 해결하고, 고른 자리(초록 블록)는 클릭을 밴드로 통과시킨다.
    const candidates = targets
    if (ev && picked) {
      // 고른 자리로 겹치던 일정을 옮긴다 → 주황에서 초록('가능')으로 바뀌며 이동,
      // 비워진 원래 자리엔 파란 회의(highlight)만 남는다.
      const movedEv: CalEvent = { ...ev, day: picked.day, startHour: picked.hour, endHour: picked.hour + span }
      const others = theirReal.filter((e) => e.id !== ev.id)
      return { ...base, events: [...others, movedEv], markEventId: ev.id, markMode: 'movedOk', candidates, candidateDurationHours: span }
    }
    return { ...base, markEventId: p.movedEventId, markMode: 'moveAsk', candidates, candidateDurationHours: span }
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
    identity: { kind: 'person', avatarId: MY_ID, hideType: true },
  }]
  const optionalIds = state.attendees.filter((a) => a.role === 'optional').map((a) => a.id)
  const schedulingEvents = eventsForScheduling(state.attendees, state.events)

  const who = state.attendees.find((a) => a.id === state.conflictFocusId)
  if (who) {
    const theirReal = state.events.filter((e) => e.ownerId === who.id)
    const conflict = theirReal.find((e) => e.day === slot.day && slot.hour >= e.startHour && slot.hour < e.endHour)
    // 지목한 '이 사람'만 조정하는 제안을 우선 만든다 — 필참 2명 이상 차단(다자/비추천) 슬롯에서도
    // 한 명씩 조율 가능. 선택 참석자 제외는 whole-slot resolveSlot으로 폴백.
    const wholeSlotProposal = resolveSlot(state.attendees, schedulingEvents, slot)
    const currentProposal = resolveBlockerFor(who, slot, schedulingEvents)
      ?? (wholeSlotProposal?.whoId === who.id ? wholeSlotProposal : null)
    const declined = currentProposal?.whoId === who.id && isDeclined(state, currentProposal)
    const fieldwork = who.softPrefs.some((pref) => pref.type === 'fieldwork' && pref.days.includes(slot.day) && slot.hour >= 9 && slot.hour < 12)
    const postLunch = who.softPrefs.some((pref) => pref.type === 'avoidPostLunch') && slot.hour === 13
    const softConflict: CalEvent | null = !conflict && (fieldwork || postLunch) ? {
      id: 'availability-mark', ownerId: who.id, day: slot.day,
      startHour: fieldwork ? 9 : slot.hour, endHour: fieldwork ? 12 : slot.hour + 1,
      title: availabilityLabel(who, slot), kind: 'fixed',
    } : null
    const events = softConflict ? [...theirReal, softConflict] : theirReal
    const nowAvailable = teamAvailability(state.attendees, schedulingEvents, slot).find((item) => item.att.id === who.id)?.ok ?? false
    panes.push({
      title: `${who.name} 캘린더`, events, highlight: slot,
      markEventId: conflict?.id ?? softConflict?.id ?? null, markMode: declined ? 'conflict' : 'requestable',
      identity: { kind: 'person', avatarId: who.id },
      footer: nowAvailable ? undefined : personFooter(who, currentProposal, declined, slot),
      closeTarget: 'person',
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
      closeTarget: 'room',
    })
  }

  if (panes.length === 1) return null
  return { day: slot.day, title: '일정 확인', note: `${slot.day} ${slot.hour}:00 상황을 나란히 확인해요`, panes }
}

// 회의실 문패(층수) 배지
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
    const verb = prop.action === 'moveFlex' ? '일정 이동 요청' : '참석 여부 확인'
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
  const mine: SidePane = { title: '내 캘린더', events: myEvents, highlight: p.slot, highlightInfo: meetingHighlightInfo(state), identity: { kind: 'person', avatarId: MY_ID, hideType: true } }
  const theirIdent = { kind: 'person' as const, avatarId: who?.id }

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
