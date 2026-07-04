// 골든 데이터 검증용 스크립트.  실행: npm run check
// 1) 전원(6명) 가능 슬롯이 없어야 함  2) 조정안 3종이 나와야 함  3) 회의실 자원 동작
import { ATTENDEES, EVENTS, ROOMS } from '../data/mock'
import { rankCandidates, generateProposals, roomStatuses, recommendRoom, resolveRoom, resolveSlot, roomProposalFor } from './scheduling'
import type { Slot } from '../types'

const candidates = rankCandidates(ATTENDEES, EVENTS)
const all = candidates.filter((c) => c.tag === 'all')
const reqOnly = candidates.filter((c) => c.tag === 'requiredOnly')

console.log('=== 후보 시간 ===')
console.log('전원(6명) 가능 슬롯 수:', all.length, all.map((c) => `${c.slot.day}${c.slot.hour}`).join(', '))
console.log('필참만 가능 슬롯 수:', reqOnly.length, reqOnly.map((c) => `${c.slot.day}${c.slot.hour}`).join(', '))

console.log('\n=== 조정안 (히어로) ===')
const proposals = generateProposals(ATTENDEES, EVENTS)
proposals.forEach((p, i) => {
  console.log(`${i + 1}. [${p.action} · 마찰 ${p.frictionLabel}] ${p.slot.day} ${p.slot.hour}:00 → ${p.detail}`)
})

console.log('\n=== 회의실 (needCap 6) ===')
for (const slot of [{ day: '화', hour: 14 }, { day: '화', hour: 15 }, { day: '금', hour: 10 }] as Slot[]) {
  const statuses = roomStatuses(ROOMS, slot, 6)
  const avail = statuses.filter((s) => s.available).map((s) => s.room.name)
  const adjustable = statuses.filter((s) => s.adjustable).map((s) => s.room.name)
  const rec = recommendRoom(ROOMS, slot, 6, '회의실 B')
  const rFix = resolveRoom(ROOMS, slot, 6, [])
  console.log(`${slot.day}${slot.hour} → 빈방 ${avail.length}곳 [${avail.join(', ')}] · 조정가능 [${adjustable.join(', ')}] · 추천 ${rec?.name ?? '없음'}${rFix ? ` · 예약조정: ${rFix.detail}` : ''}`)
}

console.log('\n=== 판정 ===')
console.log(all.length === 0 ? '✅ 전원 슬롯 없음 (히어로 발동 OK)' : '❌ 전원 슬롯이 있음 → 데이터 수정 필요')
console.log(proposals.length >= 3 ? '✅ 조정안 3종 이상' : `⚠️ 조정안 ${proposals.length}종`)

console.log('\n=== 회귀 케이스: 전원 꼭 참석 · 금10 ===')
const allRequired = ATTENDEES.map((a) => a.role === 'optional' ? { ...a, role: 'required' as const } : a)
const fri10: Slot = { day: '금', hour: 10 }
const personFri10 = resolveSlot(allRequired, EVENTS, fri10)
const roomC = ROOMS.find((r) => r.name === '미팅룸 C')!
const roomCFri10 = roomProposalFor(roomC, fri10, [])
console.log(personFri10 ? `✅ 사람 조정: ${personFri10.detail}` : '❌ 사람 조정 없음')
console.log(roomCFri10 ? `✅ 미팅룸 C 조정: ${roomCFri10.detail}` : '❌ 미팅룸 C 조정 없음')
