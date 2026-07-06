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
    (e) => e.ownerId === att.id && e.day === slot.day &&
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
    if (ev) reason = ev.kind // 'flex' | 'fixed'
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

/**
 * 수신자가 '자기 일정'을 옮길 수 있는 빈 시간 후보 전체.
 * findMoveTarget이 한 곳만 자동 제안한다면, 이건 수신자가 직접 고를 수 있게 모든 가능 슬롯을 준다.
 * (같은 요일·시간순 우선 정렬 → 재계산 비용을 시스템이 대신 계산해 보여주는 용도)
 */
export function moveTargets(event: CalEvent, events: CalEvent[], meetingSlot: Slot): Slot[] {
  const span = Math.max(1, event.endHour - event.startHour)
  const hourSet = new Set(HOURS)
  const mine = events.filter((e) => e.id !== event.id && e.ownerId === event.ownerId)
  const from: Slot = { day: event.day, hour: event.startHour }
  const fits = (start: Slot): boolean => {
    // 원래 자리와 겹치는 이동은 의미 없음(제자리 이동) → 제외
    if (start.day === from.day && start.hour < event.endHour && start.hour + span > event.startHour) return false
    for (let h = start.hour; h < start.hour + span; h++) {
      if (!hourSet.has(h)) return false // 점심(12)·범위 밖
      if (mine.some((e) => e.day === start.day && h >= e.startHour && h < e.endHour)) return false // 내 다른 일정과 충돌
      if (start.day === meetingSlot.day && h === meetingSlot.hour) return false // 회의 시간과 겹침
    }
    return true
  }
  return allSlots()
    .filter((s) => !sameSlot(s, from) && fits(s))
    .sort((a, b) => (a.day === from.day ? 0 : 1) - (b.day === from.day ? 0 : 1) || slotEarlier(a, b))
}

const FRICTION: Record<ProposalAction, { score: number; label: string }> = {
  moveFlex: { score: 1, label: '낮음' },
  concedeSoft: { score: 2, label: '중간' },
  dropOptional: { score: 3, label: '낮음 (선택 인원)' },
  moveRoomBooking: { score: 4, label: '다른 팀 협의' },
}

const hourText = (s: Slot) => `${s.day} ${s.hour}:00`

/** 특정 슬롯을 '딱 한 번의 조정'으로 전원 가능하게 만드는 조정안 (없으면 null). */
export function resolveSlot(invited: Attendee[], events: CalEvent[], slot: Slot): Proposal | null {
  const blockers = blockersAt(invited, slot, events)
  if (blockers.length !== 1) return null // 막는 사람이 0명(이미 가능)이거나 2명 이상이면 단건 해결 불가
  const b = blockers[0]
  if (b.att.role === 'host') return null // 조정 요청은 상대방에게 보내는 액션만 제안한다.

  if (b.att.role === 'optional') {
    return mkProposal('dropOptional', slot, b.att.id, {
      detail: `${b.att.name} 님(선택 참석)을 제외하면 나머지 전원 가능`,
    })
  }
  if ((b.reason === 'flex' || b.reason === 'fixed') && b.event) {
    const moveTo = findMoveTarget(b.att, slot, events)
    if (!moveTo) return null
    return mkProposal('moveFlex', slot, b.att.id, {
      detail: `${b.att.name} 님의 '${b.event.title}'을 ${hourText(moveTo)}로 이동`,
      moveTo, movedEventId: b.event.id,
    })
  }
  if (b.reason === 'soft' || b.reason === 'fieldwork') {
    return mkProposal('concedeSoft', slot, b.att.id, {
      detail: `${b.att.name} 님에게 ${hourText(slot)} 참석 가능 여부 확인`,
    })
  }
  return null
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
    if (ev) return { att, ok: false, status: ev.kind, reason: ev.kind === 'flex' ? '이동 가능한 일정' : '다른 일정(고정)' }
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
  const target = allSlots().find((s) => !sameSlot(s, slot) && isRoomFree(room, s))
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

// ── D. 중요도 자동 추정 — 필참 인원수 + 아젠다 키워드로 반응 ──

import type { Level } from '../types'
import { LEVELS } from '../types'

const IMPORTANT_KEYWORDS = ['결정', '승인', '전사', '분기', '의사결정', '전략']

/** 필참 인원수로 기본 레벨을 정하고, 아젠다 키워드가 있으면 한 단계 올린다. */
export function estimateImportance(
  agenda: string, requiredCount: number,
): { level: Level; reason: string } {
  const base: Level = requiredCount >= 5 ? '높음' : requiredCount >= 3 ? '보통' : '낮음'
  const hit = IMPORTANT_KEYWORDS.find((k) => agenda.includes(k))
  let idx = LEVELS.indexOf(base)
  if (hit) idx = Math.min(idx + 1, LEVELS.length - 1)

  const reasons = [`꼭 참석 ${requiredCount}명`]
  if (hit) reasons.push(`'${hit}' 안건`)
  return { level: LEVELS[idx], reason: reasons.join(' · ') }
}
