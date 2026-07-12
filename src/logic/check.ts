// 골든 데이터 검증용 스크립트.  실행: npm run check
// v4(비용 사다리) + 2026-07-09 감사 회귀 안전망:
//  - 표준 지정(C4: 선우·도현·민지 필참): 수15 = T0b (하늘(선택)만 걸림, 부탁 0)
//  - 6명 전부 필참(C6): 수15 = T1 (하늘=필참 → 1명 조정)
//  - 감사 P1(사다리 이관)·P2(역할 인지)·P3(호스트 통일)의 판정을 영구 탑재.
import { ATTENDEES, EVENTS, ROOMS } from '../data/mock'
import {
  rankCandidates, generateProposals, roomStatuses, recommendRoom, resolveRoom,
  resolveSlot, roomProposalFor, allSlots, availableRooms, teamAvailability,
  findBestSlot, rankSlotCosts, slotCost, compareSlotCost, sameSlot, eventsForScheduling,
  type SlotCost,
} from './scheduling'
import type { Attendee, CalEvent, Slot } from '../types'

const MAGIC: Slot = { day: '수', hour: 15 }
const HOST_ID = 'me'
const key = (s: Slot) => `${s.day}${s.hour}`
const roomNames = (slot: Slot) => availableRooms(ROOMS, slot, 6).map((r) => r.name)

// 감사는 항상 app과 같은 스케줄 이벤트(호스트 context→fixed, 5명+면 필참 context→flex)로 판정한다.
const stdEvents = eventsForScheduling(ATTENDEES, EVENTS)
const ALL_REQUIRED: Attendee[] = ATTENDEES.map((a) => a.role === 'optional' ? { ...a, role: 'required' as const } : a)
const chainEvents = eventsForScheduling(ALL_REQUIRED, EVENTS)
const C3: Attendee[] = ATTENDEES.map((a) => a.id === 'mj' ? { ...a, role: 'optional' as const } : a) // 민지=선택
const c3Events = eventsForScheduling(C3, EVENTS)

// 호스트(나)의 raw 일정 슬롯 — 실일정 2곳 + context 6곳. 추천 표면에서 절대 안 나와야 한다(감사 P3/E).
const hostRawSlots = allSlots().filter((s) =>
  EVENTS.some((e) => e.ownerId === HOST_ID && e.day === s.day && s.hour >= e.startHour && s.hour < e.endHour))

const candidates = rankCandidates(ATTENDEES, EVENTS)
const all = candidates.filter((c) => c.tag === 'all')
const reqOnly = candidates.filter((c) => c.tag === 'requiredOnly')

console.log('=== 후보 시간 ===')
console.log('전원(6명) 가능 슬롯 수:', all.length, all.map((c) => key(c.slot)).join(', '))
console.log('필참만 가능 슬롯 수:', reqOnly.length, reqOnly.map((c) => key(c.slot)).join(', '))

console.log('\n=== 조정안 (히어로) ===')
const proposals = generateProposals(ATTENDEES, stdEvents)
proposals.forEach((p, i) => {
  console.log(`${i + 1}. [${p.action} · 마찰 ${p.frictionLabel}] ${p.slot.day} ${p.slot.hour}:00 → ${p.detail}`)
})

// ── 비용 사다리 핵심 판정 ──
const bestStd = findBestSlot(ATTENDEES, stdEvents, ROOMS, 6, true)
const bestAll = findBestSlot(ALL_REQUIRED, chainEvents, ROOMS, 6, true)
const bestOnline = findBestSlot(ATTENDEES, stdEvents, ROOMS, 6, false)

console.log('\n=== 비용 사다리 (findBestSlot) ===')
const fmt = (b: typeof bestStd) => b ? `${key(b.slot)} · ${b.tier} (asks ${b.asks}, 필참조정 ${b.personAsks}, 선택제외 ${b.excludedOptionals}, 방 ${b.room?.name ?? '—'})` : '없음(카드 미표시)'
console.log('표준 지정(C4) →', fmt(bestStd))
console.log('6명 필참(C6)  →', fmt(bestAll))
console.log('온라인        →', fmt(bestOnline))

const freeRoomSlots = allSlots().filter((s) => availableRooms(ROOMS, s, 6).length > 0)

console.log('\n=== 판정 ===')
const results: boolean[] = []
const judge = (ok: boolean, pass: string, fail: string) => { results.push(ok); console.log(ok ? pass : fail) }

judge(all.length === 0,
  '✅ 전원(6명) 가능 슬롯 0개 (하늘이 수15 차단)',
  `❌ 전원 슬롯 ${all.length}개 [${all.map((c) => key(c.slot)).join(', ')}]`)
judge(!!bestStd && sameSlot(bestStd.slot, MAGIC) && bestStd.tier === 'T0b' && bestStd.asks === 0 && bestStd.excludedOptionals === 1 && bestStd.room?.name === '회의실 B',
  '✅ C4 findBestSlot = 수15 · T0b (asks 0, 선택제외 1, 회의실 B)',
  `❌ C4 = ${fmt(bestStd)}`)
judge(!!bestAll && sameSlot(bestAll.slot, MAGIC) && bestAll.tier === 'T1' && bestAll.asks === 1 && bestAll.personAsks === 1 && bestAll.personAskId === 'hn',
  '✅ C6 findBestSlot = 수15 · T1 (asks 1, 필참조정 1 = 정하늘)',
  `❌ C6 = ${fmt(bestAll)} (personAskId=${bestAll?.personAskId})`)
judge(!!bestOnline && bestOnline.asks === 0 && !bestOnline.roomAsk,
  `✅ 온라인 findBestSlot = ${bestOnline ? key(bestOnline.slot) : '?'} · asks 0 (회의실 항 소멸)`,
  `❌ 온라인 = ${fmt(bestOnline)}`)
// 방을 현실적으로 비웠어도(안전 슬롯) '추천 후보(살아있는 personAsks≤1)' 중 빈 방 있는 건 수15뿐 — 방 희소성 유지
const liveFreeRoom = allSlots().filter((s) => {
  const c = slotCost(ALL_REQUIRED, chainEvents, ROOMS, s, 6, true)
  return c.feasible && c.personAsks <= 1 && availableRooms(ROOMS, s, 6).length > 0
})
judge(liveFreeRoom.length === 1 && sameSlot(liveFreeRoom[0], MAGIC),
  `✅ 추천 후보 중 빈 방 있는 슬롯 = 수15뿐 (방 희소성 유지, 전체 빈 방 ${freeRoomSlots.length}곳)`,
  `❌ 추천 후보 빈 방 = [${liveFreeRoom.map(key).join(', ')}]`)
judge(roomNames(MAGIC).join(',') === '회의실 B',
  '✅ 수15 빈 방 = 회의실 B 1곳',
  `❌ 수15 빈 방 = [${roomNames(MAGIC).join(', ')}]`)
// 회의실 조정 연출 슬롯(목17) — 빈 방 0이라 조정 필요 + 같은 날 자연스러운 이동 타깃으로 조정안 생성(보낼 수 있음)
const roomDemo: Slot = { day: '목', hour: 17 }
const roomDemoProp = resolveRoom(ROOMS, roomDemo, 6, [])
judge(availableRooms(ROOMS, roomDemo, 6).length === 0 && !!roomDemoProp && roomDemoProp.moveTo?.day === '목',
  `✅ 목17 회의실 조정 = 빈 방 0 · 조정안 생성(같은 날 ${roomDemoProp?.moveTo?.day}${roomDemoProp?.moveTo?.hour}로 이동)`,
  `❌ 목17 회의실 조정 = 빈 방 ${availableRooms(ROOMS, roomDemo, 6).length} · ${roomDemoProp ? `${roomDemoProp.moveTo?.day}${roomDemoProp.moveTo?.hour}` : 'null(못 보냄)'}`)

// 화16 T4 데모 유지 (C4에서 도현+민지 둘 다 필참 → 다자)
const c4Multi = slotCost(ATTENDEES, stdEvents, ROOMS, { day: '화', hour: 16 }, 6, true)
judge(c4Multi.tier === 'T4' && c4Multi.personAsks === 2,
  '✅ C4 화16 = T4 (필참 2명 다자 — 카드 추천 안 함)',
  `❌ C4 화16 = ${c4Multi.tier} (personAsks ${c4Multi.personAsks})`)

// ── 감사 회귀 안전망 (구성 2종: C4 표준 · C6 전원 필참) ──
function auditConfig(label: string, invited: Attendee[], events: CalEvent[]) {
  const ranked = rankSlotCosts(invited, events, ROOMS, 6, true)
  const costs = allSlots().map((s) => slotCost(invited, events, ROOMS, s, 6, true))

  // 1. 최소성: ranked[0]보다 사전식으로 싼 feasible 슬롯이 없다 (브루트포스 대조 — 실제 비교자와 동일)
  const minOk = !!ranked[0] && !costs.some((c) => c.feasible && compareSlotCost(c, ranked[0]) < 0)
  // 2. 실행 가능성: feasible(호스트 프리)이고 personAsks===1인 슬롯은 전부 resolveSlot ≠ null
  //    (감사 B — 데드엔드 0. 호스트 차단 슬롯은 애초에 추천 대상이 아니라 제외한다 — 감사 3-2)
  const execFails = allSlots().filter((s) => {
    const c = slotCost(invited, events, ROOMS, s, 6, true)
    return c.feasible && c.personAsks === 1 && resolveSlot(invited, events, s) === null
  })
  // 3. 회의실: roomAsk인 모든 슬롯에서 resolveRoom ≠ null (감사 C)
  const roomFails = allSlots().filter((s) => slotCost(invited, events, ROOMS, s, 6, true).roomAsk && resolveRoom(ROOMS, s, 6, []) === null)
  // 4. 호스트 배제: 추천 표면(ranked) ∩ 호스트 raw 일정 = ∅ (감사 E)
  const hostHits = ranked.filter((c) => hostRawSlots.some((h) => sameSlot(h, c.slot)))
  // 5. 셈법 삼자 일치: 모든 슬롯에서 slotCost.personAsks = teamAvailability 필참 차단 수 (감사 G)
  const countMismatch = allSlots().filter((s) => {
    const pa = slotCost(invited, events, ROOMS, s, 6, true).personAsks
    const blocked = teamAvailability(invited, events, s).filter((a) => !a.ok && a.att.role === 'required').length
    return pa !== blocked
  })

  console.log(`\n=== 감사 회귀 안전망 · ${label} ===`)
  judge(minOk, `✅ [1] 최소성: ranked[0]=${key(ranked[0].slot)}가 전역 최소`, `❌ [1] 최소성 위반 (ranked[0]=${ranked[0] ? key(ranked[0].slot) : '없음'})`)
  judge(execFails.length === 0, '✅ [2] 실행 가능성: personAsks 1 슬롯 전부 resolveSlot ≠ null', `❌ [2] 데드엔드 ${execFails.length}개 [${execFails.map(key).join(', ')}]`)
  judge(roomFails.length === 0, '✅ [3] 회의실: roomAsk 슬롯 전부 resolveRoom ≠ null', `❌ [3] 회의실 데드엔드 ${roomFails.length}개 [${roomFails.map(key).join(', ')}]`)
  judge(hostHits.length === 0, '✅ [4] 호스트 배제: 추천 표면 ∩ 내 일정 = ∅', `❌ [4] 추천에 내 일정 슬롯 ${hostHits.length}개 [${hostHits.map((c) => key(c.slot)).join(', ')}]`)
  judge(countMismatch.length === 0, '✅ [5] 셈법 삼자 일치: personAsks = 필참 차단 수', `❌ [5] 셈법 불일치 ${countMismatch.length}개 [${countMismatch.map(key).join(', ')}]`)
}
auditConfig('C4 표준', ATTENDEES, stdEvents)
auditConfig('C6 전원 필참', ALL_REQUIRED, chainEvents)

// ── P2 회귀: C3(민지=선택) 화16 — 선택 동시 차단을 다자로 오판하지 않는다 ──
console.log('\n=== 감사 P2 · C3 화16 (도현 필참 + 민지 선택) ===')
const c3Multi: Slot = { day: '화', hour: 16 }
const c3Cost = slotCost(C3, c3Events, ROOMS, c3Multi, 6, true)
const c3Fix = resolveSlot(C3, c3Events, c3Multi)
judge(c3Cost.personAsks === 1 && c3Cost.excludedOptionals === 1,
  '✅ C3 화16 = personAsks 1 · 선택제외 1 (다자 아님)',
  `❌ C3 화16 personAsks ${c3Cost.personAsks} / 선택제외 ${c3Cost.excludedOptionals}`)
judge(!!c3Fix && c3Fix.whoId === 'dh' && (c3Fix.excludeIds ?? []).includes('mj'),
  `✅ C3 화16 조정안 = 도현(${c3Fix?.action}) + 민지 제외 부기`,
  `❌ C3 화16 resolveSlot=${c3Fix ? `${c3Fix.action}/${c3Fix.whoId}` : 'null'} (민지 제외=${(c3Fix?.excludeIds ?? []).join(',')})`)

// ── 회귀: 히어로 조정안(사람·회의실) 여전히 생성 ──
const fri10: Slot = { day: '금', hour: 10 }
const personFri10 = resolveSlot(ALL_REQUIRED, chainEvents, fri10)
const roomC = ROOMS.find((r) => r.name === '미팅룸 C')!
console.log('\n=== 회귀: 전원 필참 · 금10 ===')
judge(!!personFri10, `✅ 사람 조정: ${personFri10?.detail}`, '❌ 사람 조정 없음')
judge(!!roomProposalFor(roomC, fri10, []), '✅ 미팅룸 C 회의실 조정 생성', '❌ 미팅룸 C 조정 없음')

// ── 미시 비용 (동률 세분화) §5 판정 ──
console.log('\n=== 미시 비용 (동률 세분화) ===')

// 같은 (asks, friction, excludedOptionals) 그룹 안에서 미시 튜플이 오름차순인지(정렬 무결성) 검사.
function microMonotonic(ranked: SlotCost[]): { ok: boolean; at: string | null } {
  for (let i = 1; i < ranked.length; i++) {
    const a = ranked[i - 1], b = ranked[i]
    if (a.asks !== b.asks || a.friction !== b.friction || a.excludedOptionals !== b.excludedOptionals) continue
    const ta = [a.micro.asked, a.micro.dayLoad, a.micro.moveHeadroom, a.micro.weekLoad, a.micro.roomHeadroom]
    const tb = [b.micro.asked, b.micro.dayLoad, b.micro.moveHeadroom, b.micro.weekLoad, b.micro.roomHeadroom]
    for (let k = 0; k < ta.length; k++) {
      if (ta[k] < tb[k]) break
      if (ta[k] > tb[k]) return { ok: false, at: `${key(a.slot)}→${key(b.slot)}` } // 상위 미시 키 역전
    }
  }
  return { ok: true, at: null }
}

// 1. 거절 점프: C6에서 수15 차단자(하늘=hn)를 askedIds에 넣고 재랭킹 → 수15 다음 추천의 차단자 ≠ 하늘.
const rankedDecline = rankSlotCosts(ALL_REQUIRED, chainEvents, ROOMS, 6, true, { askedIds: new Set(['hn']) })
const nextAfterDecline = rankedDecline.find((c) => !sameSlot(c.slot, MAGIC))
judge(!!nextAfterDecline && nextAfterDecline.personAskId !== 'hn',
  `✅ [M1] 거절 점프: 수15(하늘) 거절 후 다음 추천=${nextAfterDecline ? key(nextAfterDecline.slot) : '없음'} · 차단자=${nextAfterDecline?.personAskId ?? '—'} (≠하늘)`,
  `❌ [M1] 거절 점프 실패: 다음 추천 차단자=${nextAfterDecline?.personAskId}`)

// 2. 양보 연타 방지: 화14 차단자(선우=sw)를 askedIds에 넣으면 같은 그룹서 sw 슬롯이 앞서지 않는다(asked 우선키).
const rankedSw = rankSlotCosts(ALL_REQUIRED, chainEvents, ROOMS, 6, true, { askedIds: new Set(['sw']) })
const swMono = microMonotonic(rankedSw)
judge(swMono.ok,
  '✅ [M1] 양보 연타 방지: 수락자(선우) 슬롯이 같은 그룹서 앞서지 않음',
  `❌ [M1] 양보 연타: 역전 지점 ${swMono.at}`)

// 3. 동률 세분 작동: 컨텍스트 없이도 같은 그룹은 M2(당일 부담)~M5 오름차순으로 정렬된다.
const monoC6 = microMonotonic(rankSlotCosts(ALL_REQUIRED, chainEvents, ROOMS, 6, true))
const monoC4 = microMonotonic(rankSlotCosts(ATTENDEES, stdEvents, ROOMS, 6, true))
judge(monoC6.ok && monoC4.ok,
  '✅ [M2~M5] 동률 세분: 같은 (asks,friction) 그룹서 미시 키 오름차순',
  `❌ [M2~M5] 동률 세분 역전 (C6:${monoC6.at ?? '—'} / C4:${monoC4.at ?? '—'})`)

// 4. 결정성: 같은 입력 → 같은 순서 (미시 키 추가 후에도 비결정 요소 없음).
const seq = () => rankSlotCosts(ALL_REQUIRED, chainEvents, ROOMS, 6, true, { askedIds: new Set(['hn']) }).map((c) => key(c.slot)).join(',')
judge(seq() === seq(),
  '✅ [결정성] 같은 입력 → 같은 순서',
  '❌ [결정성] 순서가 흔들림')

// 5. 상위 키 불변: 미시 키는 티어·최소성을 바꾸지 않는다 — best(수15) 티어/차단자 여전히 동일.
const bestMicro = findBestSlot(ALL_REQUIRED, chainEvents, ROOMS, 6, true, { askedIds: new Set<string>() })
judge(!!bestMicro && sameSlot(bestMicro.slot, MAGIC) && bestMicro.tier === 'T1' && bestMicro.personAskId === 'hn',
  '✅ [불변] 빈 컨텍스트 best = 수15 · T1 · 하늘 (미시가 상위 판정 안 바꿈)',
  `❌ [불변] best=${bestMicro ? key(bestMicro.slot) + '/' + bestMicro.tier : '없음'}`)

const failCount = results.filter((r) => !r).length
console.log(`\n${failCount === 0 ? `🎉 전 항목 통과 (${results.length}/${results.length})` : `🔴 ${failCount}개 실패 / ${results.length}`}`)
