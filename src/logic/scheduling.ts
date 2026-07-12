// ── 스케줄링 로직 ──────────────────────────────────────────────
// 구현 스펙 §5 그대로:
//  A. rankCandidates  — 후보 시간 랭킹 (전원 → 필참 → 가장 빠름)
//  B. generateProposals — 충돌 지점에서 '무엇을 옮기면 전원 가능'한 조정안 생성 (히어로)
//  D. estimateImportance — 아젠다 키워드 + 인원수로 회의 중요도 추정 (페이크)

import type {
  Attendee, CalEvent, Candidate, Day, Proposal, ProposalAction, Room, Slot,
} from '../types'
import { DAYS, HOURS } from '../types'

// ── 기본 헬퍼 ──────────────────────────────────────────────────

export function slotKey(s: Slot): string {
  return `${s.day}-${s.hour}`
}

export function sameSlot(a: Slot, b: Slot): boolean {
  return a.day === b.day && a.hour === b.hour
}

/** 그 사람이 그 시각에 잡혀 있는 일정(겹치는 이벤트)을 반환. 없으면 null. */
export function eventAt(att: Attendee, slot: Slot, events: CalEvent[]): CalEvent | null {
  return events.find(
    (e) => e.kind !== 'context' && e.ownerId === att.id && e.day === slot.day &&
      slot.hour >= e.startHour && slot.hour < e.endHour,
  ) ?? null
}

/** 소프트 선호를 위반하는지 (점심 직후 / 외근 오전). */
export function violatesSoft(att: Attendee, slot: Slot): boolean {
  return att.softPrefs.some((p) => {
    if (p.type === 'avoidPostLunch') return slot.hour === 13
    if (p.type === 'fieldwork') return p.days.includes(slot.day) && slot.hour < 12
    return false
  })
}

/** 그 시각에 참석 가능한지 (일정도 없고 소프트 위반도 없음). */
export function isFree(att: Attendee, slot: Slot, events: CalEvent[]): boolean {
  return eventAt(att, slot, events) === null && !violatesSoft(att, slot)
}

/**
 * 5명 이상 꼭참석 회의는 '보여주는 일정'도 조율 비용에 들어간다.
 * 작은 회의에서는 context를 밀도 표현으로만 두고, 큰 회의에서는 꼭 참석자가 가진 context를
 * 이동 가능한 일정처럼 계산해 다자간 충돌을 드러낸다. 호스트 context는 계속 표시용으로만 둔다.
 */
export function eventsForScheduling(invited: Attendee[], events: CalEvent[]): CalEvent[] {
  const required = invited.filter((a) => a.role !== 'optional')
  const chain = required.length >= 5
  const requiredParticipantIds = new Set(required.filter((a) => a.role !== 'host').map((a) => a.id))
  const hostId = invited.find((a) => a.role === 'host')?.id
  return events.map((event) => {
    if (event.kind !== 'context') return event
    // 내 일정은 표시용 context라도 그 시각을 잡는 건 착오 — 후보 계산에서 빼려면 fixed로 승격한다.
    // (UI '내 일정 있는 시간' 힌트와 사다리 판정을 한 기준으로 통일 — 감사 P3)
    if (event.ownerId === hostId) return { ...event, kind: 'fixed' as const }
    // 5명 이상 꼭참석이면 꼭참석자의 표시용 일정도 이동 대상으로 계산해 다자 충돌을 드러낸다.
    if (chain && requiredParticipantIds.has(event.ownerId)) return { ...event, kind: 'flex' as const }
    return event
  })
}

/** 한 주의 모든 슬롯. */
export function allSlots(): Slot[] {
  const out: Slot[] = []
  for (const day of DAYS) for (const hour of HOURS) out.push({ day, hour })
  return out
}

const slotIndex = (s: Slot) => DAYS.indexOf(s.day) * 100 + s.hour
export function slotEarlier(a: Slot, b: Slot): number {
  return slotIndex(a) - slotIndex(b)
}

// ── 차단자 분석 ────────────────────────────────────────────────

type BlockReason = 'flex' | 'fixed' | 'soft' | 'fieldwork'
interface Blocker {
  att: Attendee
  reason: BlockReason
  event: CalEvent | null
}

function blockersAt(invited: Attendee[], slot: Slot, events: CalEvent[]): Blocker[] {
  const result: Blocker[] = []
  for (const att of invited) {
    if (isFree(att, slot, events)) continue
    const ev = eventAt(att, slot, events)
    let reason: BlockReason
    if (ev) reason = ev.kind === 'flex' ? 'flex' : 'fixed'
    else if (att.softPrefs.some((p) => p.type === 'avoidPostLunch') && slot.hour === 13) reason = 'soft'
    else reason = 'fieldwork'
    result.push({ att, reason, event: ev })
  }
  return result
}

// ── A. 후보 시간 랭킹 ──────────────────────────────────────────

export function rankCandidates(invited: Attendee[], events: CalEvent[]): Candidate[] {
  const requiredIds = invited.filter((a) => a.role !== 'optional').map((a) => a.id)

  const candidates: Candidate[] = []
  for (const slot of allSlots()) {
    const freeIds: string[] = []
    const missingIds: string[] = []
    for (const att of invited) {
      if (isFree(att, slot, events)) freeIds.push(att.id)
      else missingIds.push(att.id)
    }
    const requiredAllFree = requiredIds.every((id) => freeIds.includes(id))
    if (!requiredAllFree) continue

    const tag = missingIds.length === 0 ? 'all' : 'requiredOnly'
    candidates.push({ slot, tag, freeIds, missingIds, softWarnings: [] })
  }

  // 정렬: 전원(all) 먼저 → 그다음 필참(requiredOnly) → 각 그룹 안에서는 빠른 시간
  const rank = (c: Candidate) => (c.tag === 'all' ? 0 : 1)
  return candidates.sort((a, b) => rank(a) - rank(b) || slotEarlier(a.slot, b.slot))
}

// ── B. 조정안 생성 (히어로) ────────────────────────────────────

/** flex 일정을 옮길, 같은 사람의 빈 슬롯을 찾는다 (같은 요일·이후 시간 우선). */
function findMoveTarget(att: Attendee, from: Slot, events: CalEvent[]): Slot | null {
  const sameDayLater = allSlots().filter(
    (s) => s.day === from.day && s.hour > from.hour && isFree(att, s, events),
  )
  if (sameDayLater.length) return sameDayLater[0]
  const anyFree = allSlots().filter((s) => !sameSlot(s, from) && isFree(att, s, events))
  anyFree.sort((a, b) => slotEarlier(a, b))
  return anyFree[0] ?? null
}

export interface MoveTargetCost {
  slot: Slot
  dayChanged: number
  dayDistance: number
  slotDistance: number
  addedBusyIslands: number
  longestFreeBlockLoss: number
  badgeLabel: string  // 뱃지/행 라벨 — 거리·구조 언어만(본인 캘린더의 사실). §3 규격
  heroSub: string     // 히어로 카드 보조 한 줄(같은 날/인접일 때만, 다른 날이면 '')
}

const AMPM = (hour: number) => (hour < 12 ? '오전' : '오후')
const REL_DAY = ['오늘', '다음 날', '이틀 뒤', '사흘 뒤', '나흘 뒤']

function busyIslandCount(events: CalEvent[], target: Slot | null, span: number): number {
  let count = 0
  for (const day of DAYS) {
    let wasBusy = false
    for (const hour of HOURS) {
      const eventBusy = events.some((e) => e.day === day && hour >= e.startHour && hour < e.endHour)
      const targetBusy = !!target && target.day === day && hour >= target.hour && hour < target.hour + span
      const busy = eventBusy || targetBusy
      if (busy && !wasBusy) count++
      wasBusy = busy
    }
  }
  return count
}

function totalLongestFreeRun(events: CalEvent[], target: Slot | null, span: number): number {
  let total = 0
  for (const day of DAYS) {
    let longest = 0
    let run = 0
    for (const hour of HOURS) {
      const eventBusy = events.some((e) => e.day === day && hour >= e.startHour && hour < e.endHour)
      const targetBusy = !!target && target.day === day && hour >= target.hour && hour < target.hour + span
      if (eventBusy || targetBusy) run = 0
      else {
        run++
        longest = Math.max(longest, run)
      }
    }
    total += longest
  }
  return total
}

function moveReason(
  from: Slot,
  slot: Slot,
  span: number,
  mine: CalEvent[],
  dayDistance: number,
): Pick<MoveTargetCost, 'badgeLabel' | 'heroSub'> {
  if (slot.day === from.day) {
    // 그 요일에서 옮긴 자리가 내 다른 일정과 앞뒤로 맞닿는가(하루가 조각나지 않게 이어지는가)
    const adjacent = mine.some((e) => e.day === slot.day && (e.endHour === slot.hour || slot.hour + span === e.startHour))
    if (adjacent) {
      return { badgeLabel: '같은 날 · 다른 일정과 이어져요', heroSub: '다른 일정 바로 옆이라 사이가 비지 않아요' }
    }
    const dir = slot.hour > from.hour ? '뒤' : '앞'
    const n = Math.abs(slot.hour - from.hour)
    return { badgeLabel: `같은 날 · ${n}시간 ${dir}`, heroSub: '원래 일정과 같은 요일이에요' }
  }
  // 다른 날 — 상대 거리 + 오전/오후(본인 캘린더의 사실). 히어로 보조 한 줄은 생략(§6-3).
  const rel = REL_DAY[dayDistance] ?? `${dayDistance}일 뒤`
  return { badgeLabel: `${rel} ${AMPM(slot.hour)}`, heroSub: '' }
}

/**
 * 수신자가 '자기 일정'을 옮길 수 있는 빈 시간 전체를 개인 이동 비용으로 정렬한다.
 * 순서: 같은 날짜 → 가까운 시간 → 빈 시간 구조 보존 → 빠른 시간.
 * 제목·선호는 추측하지 않으며, 화면에서 보이는 내 일정(context 포함)과 겹치는 후보는 제외한다.
 */
export function rankMoveTargets(event: CalEvent, events: CalEvent[], meetingSlot: Slot): MoveTargetCost[] {
  const span = Math.max(1, event.endHour - event.startHour)
  const hourSet = new Set(HOURS)
  const mine = events.filter((e) => e.id !== event.id && e.ownerId === event.ownerId)
  const from: Slot = { day: event.day, hour: event.startHour }
  const fits = (start: Slot): boolean => {
    // 원래 자리와 겹치는 이동은 의미 없음(제자리 이동) → 제외
    if (start.day === from.day && start.hour < event.endHour && start.hour + span > event.startHour) return false
    for (let h = start.hour; h < start.hour + span; h++) {
      if (!hourSet.has(h)) return false // 근무 시간 밖
      if (mine.some((e) => e.day === start.day && h >= e.startHour && h < e.endHour)) return false // 내 다른 일정과 충돌
      if (start.day === meetingSlot.day && h === meetingSlot.hour) return false // 회의 시간과 겹침
    }
    return true
  }
  const baseBusyIslands = busyIslandCount(mine, null, span)
  const baseLongestFreeRun = totalLongestFreeRun(mine, null, span)

  return allSlots()
    .filter((s) => !sameSlot(s, from) && fits(s))
    .map((slot) => {
      const dayDistance = Math.abs(DAYS.indexOf(slot.day) - DAYS.indexOf(from.day))
      const addedBusyIslands = busyIslandCount(mine, slot, span) - baseBusyIslands
      const longestFreeBlockLoss = Math.max(0, baseLongestFreeRun - totalLongestFreeRun(mine, slot, span))
      return {
        slot,
        dayChanged: slot.day === from.day ? 0 : 1,
        dayDistance,
        slotDistance: Math.abs(HOURS.indexOf(slot.hour) - HOURS.indexOf(from.hour)),
        addedBusyIslands,
        longestFreeBlockLoss,
        ...moveReason(from, slot, span, mine, dayDistance),
      }
    })
    .sort((a, b) =>
      a.dayChanged - b.dayChanged ||
      a.dayDistance - b.dayDistance ||
      a.slotDistance - b.slotDistance ||
      a.addedBusyIslands - b.addedBusyIslands ||
      a.longestFreeBlockLoss - b.longestFreeBlockLoss ||
      slotEarlier(a.slot, b.slot),
    )
}

/** 캘린더 후보 표면도 수신자 컨트롤 박스와 같은 가능한 시작점을 사용한다. */
export function moveTargets(event: CalEvent, events: CalEvent[], meetingSlot: Slot): Slot[] {
  return rankMoveTargets(event, events, meetingSlot).map((target) => target.slot)
}

const FRICTION: Record<ProposalAction, { score: number; label: string }> = {
  moveFlex: { score: 1, label: '낮음' },
  concedeSoft: { score: 2, label: '중간' },
  dropOptional: { score: 3, label: '낮음 (선택 인원)' },
  moveRoomBooking: { score: 4, label: '다른 팀 협의' },
}

const hourText = (s: Slot) => `${s.day} ${s.hour}:00`

/** 특정 슬롯을 '딱 한 번의 조정'으로 전원 가능하게 만드는 조정안 (없으면 null).
 *  exact-1 판정은 '필참 기준'이다: 선택 차단자는 '함께 제외'(excludeIds)로 부기하고 부탁 수에 안 넣는다.
 *  (감사 P2 — 선택 동시 차단을 다자 충돌로 오판하던 것을 사다리 personAsks와 통일) */
export function resolveSlot(invited: Attendee[], events: CalEvent[], slot: Slot): Proposal | null {
  const blockers = blockersAt(invited, slot, events)
  const host = blockers.some((b) => b.att.role === 'host')
  if (host) return null // 내 일정이 있는 시간 — 상대에게 보내는 조정안이 없다
  const required = blockers.filter((b) => b.att.role === 'required')
  const optional = blockers.filter((b) => b.att.role === 'optional')
  const excludeIds = optional.map((o) => o.att.id) // 선택 차단자는 조정안 수락 시 함께 제외

  if (required.length === 0) {
    // 필참은 전원 가능. 선택 차단자만 있을 때 — 정확히 1명이면 '제외' 제안(그 외는 단건 아님).
    if (optional.length === 1) {
      return mkProposal('dropOptional', slot, optional[0].att.id, {
        detail: `${optional[0].att.name} 님(선택 참석)을 제외하면 나머지 전원 가능`,
      })
    }
    return null
  }
  // 정책: 부탁 1회짜리(필참 1명)만 조정안을 만든다. 필참 2명+는 진짜 다자(T4) — 더 싼 시간으로 우회.
  if (required.length !== 1) return null
  const b = required[0]
  if ((b.reason === 'flex' || b.reason === 'fixed') && b.event) {
    const moveTo = findMoveTarget(b.att, slot, events)
    if (!moveTo) return null
    return mkProposal('moveFlex', slot, b.att.id, {
      detail: `${b.att.name} 님의 '${b.event.title}'을 ${hourText(moveTo)}로 이동`,
      moveTo, movedEventId: b.event.id, excludeIds,
    })
  }
  if (b.reason === 'soft' || b.reason === 'fieldwork') {
    return mkProposal('concedeSoft', slot, b.att.id, {
      detail: `${b.att.name} 님에게 ${hourText(slot)} 참석 가능 여부 확인`,
      excludeIds,
    })
  }
  return null
}

// ── 비용 사다리 (추천 우선도) ─────────────────────────────────
// 설계 의도(로직 계획 §0): "필참 N명이면 매직 on/off" 같은 분기 규칙을 만들지 않는다.
// 모든 슬롯에 '조정 비용'을 매기고, 추천은 항상 최소 비용 티어를 보여준다.
//  - 필참이 적으면 비용 0(완벽한 시간)이 존재 → 카드가 자연히 매직 카드가 되고,
//  - 필참이 많으면 비용 0이 소멸 → 카드가 자연히 "1명만 조정하면 되는 시간"이 된다.
// 같은 카드·같은 로직, 동작이 데이터에서 창발한다.

export type Tier = 'T0' | 'T0b' | 'T1' | 'T2' | 'T3' | 'T4'

// 미시 비용 컨텍스트 — 이번 조율에서 이미 거절·양보(수락) 이력이 있는 사람 집합(재요청 회피 M1용).
export interface RankContext { askedIds?: Set<string> }

// 동률 세분화 미시 키(전부 오름차순 정렬). 사람 평가 언어로 노출 금지 — 랭킹 내부 전용.
export interface MicroCost {
  asked: 0 | 1        // M1 재요청 회피: 차단자가 이미 거절/양보한 사람이면 1
  dayLoad: number     // M2 당일 부담: 차단자의 그 요일 총 일정 시간
  moveHeadroom: number // M3 이동 여지: 차단 일정의 이동 가능 슬롯 수의 '음수'(많을수록 앞)
  weekLoad: number    // M4 주간 부담: 차단자의 주간 총 일정 시간
  roomHeadroom: number // M5 회의실 여지: 조정 대상 방의 빈 슬롯 수의 '음수'(roomAsk 아니면 0)
}

export interface SlotCost {
  slot: Slot
  room: Room | null        // 확보 가능한 빈 방(표시용). needsRoom=false거나 없으면 null
  feasible: boolean        // false = 호스트 차단 or 정원 맞는 방 자체가 없음(방 필요 모드)
  asks: number             // 부탁 횟수 = personAsks + (roomAsk ? 1 : 0)
  friction: number         // 마찰 합 (moveFlex 1 · concedeSoft 2 · moveRoomBooking 4)
  excludedOptionals: number // 부탁 없이 빠지는 선택 참석자 수
  personAsks: number       // 차단된 필참 수
  personAskId: string | null // personAsks===1일 때 그 필참자 id (목록/카드 라벨에 이름 표기용)
  roomAsk: boolean         // 빈 방 없어 회의실 조정 필요
  blockedOptionalIds: string[]
  tier: Tier
  micro: MicroCost         // 동률(asks·friction 같을 때) 세분화 신호 — 캘린더 구조에서만 도출
}

/** 그 사람의 그 요일 총 일정 시간(시간 수). raw 이벤트(context 포함) 합산 — 표시용이어도 그 사람의 계획. */
function dayLoadOf(attId: string, day: string, events: CalEvent[]): number {
  return events
    .filter((e) => e.ownerId === attId && e.day === day)
    .reduce((sum, e) => sum + Math.max(0, e.endHour - e.startHour), 0)
}
/** 그 사람의 주간 총 일정 시간. */
function weekLoadOf(attId: string, events: CalEvent[]): number {
  return events
    .filter((e) => e.ownerId === attId)
    .reduce((sum, e) => sum + Math.max(0, e.endHour - e.startHour), 0)
}

/** 사전식 비용 튜플의 티어 라벨. personAsks 2명 이상(T4)은 추천 대상에서 제외한다. */
export function slotTier(c: {
  asks: number; personAsks: number; roomAsk: boolean; excludedOptionals: number
}): Tier {
  if (c.personAsks >= 2) return 'T4'                              // 필참 2명 이상 조정 — 카드로 추천하지 않음
  if (c.asks === 0) return c.excludedOptionals > 0 ? 'T0b' : 'T0' // 부탁 0 (선택 제외만 있으면 T0b)
  if (c.personAsks === 1 && !c.roomAsk) return 'T1'              // 필참 1명 조정
  if (c.personAsks === 0 && c.roomAsk) return 'T2'              // 회의실만 조정
  return 'T3'                                                     // 필참 1명 + 회의실 (부탁 2, 1건씩 순차)
}

/**
 * 슬롯 1개의 조정 비용. 다인 슬롯은 '세기(counting)'로만 계산한다(다인 조정안 탐색 아님).
 * needsRoom=false면 회의실 항을 사다리에서 뺀다(온라인 모드).
 */
export function slotCost(
  invited: Attendee[], events: CalEvent[], rooms: Room[], slot: Slot, needCap: number, needsRoom: boolean,
  ctx?: RankContext,
): SlotCost {
  let feasible = true
  let personAsks = 0
  let personAskId: string | null = null
  let personAskAtt: Attendee | null = null
  let personAskEvent: CalEvent | null = null // 차단 이벤트(soft/fieldwork면 null — 옮길 게 없음)
  let friction = 0
  let excludedOptionals = 0
  const blockedOptionalIds: string[] = []

  for (const a of teamAvailability(invited, events, slot)) {
    if (a.ok) continue
    if (a.att.role === 'host') { feasible = false; continue } // 호스트 차단 → 실행 불가
    if (a.att.role === 'optional') {
      excludedOptionals++
      blockedOptionalIds.push(a.att.id)
      continue // 선택 참석 제외는 부탁이 아니다
    }
    personAsks++
    // 1명일 때만 이름·차단자 추적(2명째부터 T4 → null)
    if (personAsks === 1) {
      personAskId = a.att.id
      personAskAtt = a.att
      personAskEvent = eventAt(a.att, slot, events)
    } else {
      personAskId = null
      personAskAtt = null
      personAskEvent = null
    }
    // 마찰: flex 1 / soft·fieldwork 2 / fixed 1 (기존 FRICTION 상수 재사용)
    friction += (a.status === 'soft' || a.status === 'fieldwork') ? FRICTION.concedeSoft.score : FRICTION.moveFlex.score
  }

  let roomAsk = false
  let room: Room | null = null
  if (needsRoom) {
    const free = availableRooms(rooms, slot, needCap)
    if (free.length > 0) {
      room = recommendRoom(rooms, slot, needCap, '')
    } else if (roomStatuses(rooms, slot, needCap).some((s) => s.reason !== '인원 초과')) {
      roomAsk = true // 정원 맞는 방은 있으나 예약됨 → 회의실 조정 1건
      friction += FRICTION.moveRoomBooking.score
    } else {
      feasible = false // 정원 맞는 방 자체가 없음
    }
  }

  // 미시 비용 — 동률 안의 서열을 캘린더 구조만으로(입력 제로) 계산. 사람 축 먼저, 회의실 축은 그다음.
  const micro: MicroCost = { asked: 0, dayLoad: 0, moveHeadroom: 0, weekLoad: 0, roomHeadroom: 0 }
  if (personAskId && personAskAtt) {
    micro.asked = ctx?.askedIds?.has(personAskId) ? 1 : 0
    micro.dayLoad = dayLoadOf(personAskId, slot.day, events)
    micro.weekLoad = weekLoadOf(personAskId, events)
    // 옮길 곳이 많은 일정일수록 앞(음수 저장). concedeSoft(옮길 이벤트 없음)는 0 — 같은 friction 그룹서 자연 상쇄.
    micro.moveHeadroom = personAskEvent ? -moveTargets(personAskEvent, events, slot).length : 0
  }
  if (roomAsk) {
    const rp = resolveRoom(rooms, slot, needCap, [])
    const rm = rp?.roomName ? rooms.find((r) => r.name === rp.roomName) : null
    if (rm) micro.roomHeadroom = -allSlots().filter((s) => isRoomFree(rm, s)).length
  }

  const asks = personAsks + (roomAsk ? 1 : 0)
  const tier = slotTier({ asks, personAsks, roomAsk, excludedOptionals })
  return { slot, room, feasible, asks, friction, excludedOptionals, personAsks, personAskId, roomAsk, blockedOptionalIds, tier, micro }
}

/**
 * 비용 사다리 정렬 전체 목록 (feasible · 필참 조정 ≤1 · T4 제외). 사전식 (부탁 수, 마찰 합,
 * 선택 제외 수, 슬롯 빠름). 카드(1위)·대안 목록(상위 N)·check(전체)가 이 한 정렬을 공유한다.
 */
export function rankSlotCosts(
  invited: Attendee[], events: CalEvent[], rooms: Room[], needCap: number, needsRoom: boolean,
  ctx?: RankContext,
): SlotCost[] {
  return allSlots()
    .map((s) => slotCost(invited, events, rooms, s, needCap, needsRoom, ctx))
    .filter((c) => c.feasible && c.personAsks <= 1)
    .sort(compareSlotCost)
}

/** 사다리 비교자 — 상위 키(부탁·마찰·선택제외) 다음에 미시 키 M1~M5, 최후에 빠른 시간.
 *  미시 키는 상위 키가 전부 동률일 때만 작동한다(티어·최소성 판정을 바꾸지 않음). */
export function compareSlotCost(a: SlotCost, b: SlotCost): number {
  return (
    a.asks - b.asks ||
    a.friction - b.friction ||
    a.excludedOptionals - b.excludedOptionals ||
    a.micro.asked - b.micro.asked ||             // M1 재요청 회피
    a.micro.dayLoad - b.micro.dayLoad ||          // M2 당일 부담
    a.micro.moveHeadroom - b.micro.moveHeadroom ||// M3 이동 여지(음수 저장 → 오름차순=여지 많은 순)
    a.micro.weekLoad - b.micro.weekLoad ||        // M4 주간 부담
    a.micro.roomHeadroom - b.micro.roomHeadroom ||// M5 회의실 여지
    slotEarlier(a.slot, b.slot)                   // 최후: 빠른 시간(결정성 보장)
  )
}

/**
 * 전 슬롯에서 최소 비용 티어 1건 = 사다리 정렬의 첫 원소.
 * personAsks ≥ 2(T4)는 추천 대상에서 제외 — T4만 남으면 null(카드 미표시).
 */
export function findBestSlot(
  invited: Attendee[], events: CalEvent[], rooms: Room[], needCap: number, needsRoom: boolean,
  ctx?: RankContext,
): SlotCost | null {
  return rankSlotCosts(invited, events, rooms, needCap, needsRoom, ctx)[0] ?? null
}

export function generateProposals(invited: Attendee[], events: CalEvent[]): Proposal[] {
  const raw: Proposal[] = []
  for (const slot of allSlots()) {
    const p = resolveSlot(invited, events, slot)
    if (p) raw.push(p)
  }
  // 액션별로 가장 빠른 슬롯 하나씩만 큐레이션 → 깔끔한 3장
  const best = new Map<ProposalAction, Proposal>()
  for (const p of raw) {
    const cur = best.get(p.action)
    if (!cur || slotEarlier(p.slot, cur.slot) < 0) best.set(p.action, p)
  }
  const order: ProposalAction[] = ['moveFlex', 'concedeSoft', 'dropOptional']
  return order.filter((a) => best.has(a)).map((a) => best.get(a)!)
}

// ── 특정 시간의 팀 가능여부 (시간 선택 시 한눈에) ──
export interface Avail {
  att: Attendee
  ok: boolean
  status: 'free' | 'fixed' | 'flex' | 'soft' | 'fieldwork'
  reason: string
}

export function teamAvailability(invited: Attendee[], events: CalEvent[], slot: Slot): Avail[] {
  return invited.map((att) => {
    const ev = eventAt(att, slot, events)
    if (!ev && !violatesSoft(att, slot)) return { att, ok: true, status: 'free', reason: '가능' }
    if (ev) return { att, ok: false, status: ev.kind === 'flex' ? 'flex' : 'fixed', reason: ev.kind === 'flex' ? '이동 가능한 일정' : '다른 일정(고정)' }
    const post = att.softPrefs.some((p) => p.type === 'avoidPostLunch') && slot.hour === 13
    return { att, ok: false, status: post ? 'soft' : 'fieldwork', reason: post ? '점심 직후 회피' : '오전 외근' }
  })
}

// ── 회의실(장소) 가용여부 — 사람·시간과 함께 맞추는 세 번째 자원 ──
export interface RoomStatus {
  room: Room
  available: boolean         // 지금 바로 쓸 수 있음
  adjustable: boolean        // 예약돼 있지만 '이동 가능한 예약'이라 협의 가능
  reason: '' | '예약됨' | '조정 가능' | '인원 초과'
  booking?: import('../types').RoomBooking // 그 시간의 다른 팀 예약
}

export function bookingAt(room: Room, slot: Slot) {
  return room.bookings.find((b) => b.day === slot.day && b.hour === slot.hour) ?? null
}

export function isRoomFree(room: Room, slot: Slot): boolean {
  return bookingAt(room, slot) === null
}

/** 회의실의 예약 시간표를 캘린더 이벤트로 변환 (분할 뷰의 '세 번째 시간표'). */
export function roomEvents(room: Room): CalEvent[] {
  return room.bookings.map((b) => ({
    id: roomBookingId(room, b.day, b.hour),
    ownerId: `room:${room.name}`,
    day: b.day,
    startHour: b.hour,
    endHour: b.hour + 1,
    title: `${b.by} 예약`,
    // 다른 팀 예약은 기본 중립(회색). '조정 가능/이동' 여부는 마크로만 표시.
    kind: 'fixed',
  }))
}
export function roomBookingId(room: Room, day: Day, hour: number): string {
  return `room:${room.name}:${day}${hour}`
}

export function roomStatuses(rooms: Room[], slot: Slot, needCapacity: number): RoomStatus[] {
  return rooms.map((room) => {
    if (room.capacity < needCapacity) return { room, available: false, adjustable: false, reason: '인원 초과' }
    const booking = bookingAt(room, slot)
    if (!booking) return { room, available: true, adjustable: false, reason: '' }
    return { room, available: false, adjustable: booking.movable, reason: booking.movable ? '조정 가능' : '예약됨', booking }
  })
}

export function availableRooms(rooms: Room[], slot: Slot, needCapacity: number): Room[] {
  return roomStatuses(rooms, slot, needCapacity).filter((s) => s.available).map((s) => s.room)
}

/** 필요한 인원에 가장 가까운 빈 방을 추천한다. 같은 정원이면 기존 선택 방을 우선한다. */
export function recommendRoom(rooms: Room[], slot: Slot, needCapacity: number, preferredName: string): Room | null {
  const avail = availableRooms(rooms, slot, needCapacity)
  return avail.sort((a, b) => {
    const fit = (a.capacity - needCapacity) - (b.capacity - needCapacity)
    if (fit !== 0) return fit
    if (a.name === preferredName && b.name !== preferredName) return -1
    if (b.name === preferredName && a.name !== preferredName) return 1
    return a.name.localeCompare(b.name)
  })[0] ?? null
}

/** 특정 회의실의 그 시간 예약을 옮겨 방을 확보하는 요청 (예약이 있고 옮길 빈 시간이 있으면). */
export function roomProposalFor(room: Room, slot: Slot, excludeIds: string[]): Proposal | null {
  const booking = bookingAt(room, slot)
  if (!booking) return null
  // 옮길 자리는 '같은 날 가까운 빈 시간' 우선 — 엉뚱한 요일(예: 월요일 아침)로 밀지 않는다.
  const target = allSlots()
    .filter((s) => !sameSlot(s, slot) && isRoomFree(room, s))
    .sort((a, b) => (a.day === slot.day ? 0 : 1) - (b.day === slot.day ? 0 : 1) || slotEarlier(a, b))[0]
  if (!target) return null
  return mkProposal('moveRoomBooking', slot, booking.by, {
    detail: `${room.name}에 ${booking.by} 예약이 잡혀 있어요`,
    moveTo: target,
    movedEventId: roomBookingId(room, slot.day, slot.hour),
    roomName: room.name,
    excludeIds,
  })
}

/** 빈 방이 없을 때 추천하는 예약 조정안 (이동 가능한 예약 우선). */
export function resolveRoom(rooms: Room[], slot: Slot, needCapacity: number, excludeIds: string[]): Proposal | null {
  if (availableRooms(rooms, slot, needCapacity).length > 0) return null // 빈 방 있으면 협의 불필요
  for (const { room, adjustable } of roomStatuses(rooms, slot, needCapacity)) {
    if (!adjustable) continue
    const p = roomProposalFor(room, slot, excludeIds)
    if (p) return p
  }
  return null
}

let pid = 0
function mkProposal(
  action: ProposalAction, slot: Slot, whoId: string,
  extra: Partial<Proposal>,
): Proposal {
  const f = FRICTION[action]
  return {
    id: `p${++pid}`,
    action, slot, whoId,
    detail: extra.detail ?? '',
    moveTo: extra.moveTo,
    movedEventId: extra.movedEventId,
    resultText: '전원 가능',
    friction: f.score,
    frictionLabel: f.label,
    ...extra,
  }
}

// ── D. 중요도 자동 추정 ──

import type { Level } from '../types'

/** 중요도 자동 추정 — 위조 비용이 있는 구조 신호(필참 인원수)만 사용.
 *  키워드·텍스트 신호 금지: 위조 비용 0인 신호는 남의 시간을 미는 명분이 될 수 없다.
 *  필참 수는 자기 제한적 — 부풀리면 조율 비용(맞춰야 할 사람 수)이 함께 커진다.
 *  중요도는 표시 전용: 조정안 생성·정렬·수락 어디에도 입력하지 않는다(동결). */
export function estimateImportance(requiredCount: number): { level: Level; reason: string } {
  const level: Level = requiredCount >= 5 ? '높음' : requiredCount >= 3 ? '보통' : '낮음'
  return { level, reason: `꼭 참석 ${requiredCount}명` }
}
