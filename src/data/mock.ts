// ── 골든 목업 데이터 ────────────────────────────────────────────
// 의도적으로 '6명 전원이 동시에 비는 슬롯이 없도록' 설계됨.
// 그래야 핵심(③ 조정안 대행)이 발동한다.
// 데이터를 바꾸면 src/logic/check.ts 로 결과를 재확인할 것.

import type { Attendee, CalEvent, Room } from '../types'

export const TEAM_NAME = '우리 팀'

// 회의실 — 정원(capacity) + 다른 팀 예약(bookings).
// 골든 설계:
//  · 화 14시(사람 히어로): 회의실 B 예약 → 빈 방(미팅룸 C)이 있어 방 교체로 해결 (협의 불필요)
//  · 화 15시/금 10시(회의실 히어로): 6인 이상 방이 전부 예약 → 회의실 B 예약만 이동 가능 → 예약 조정
export const ROOMS: Room[] = [
  { name: '회의실 B', capacity: 6, meta: '6인 · 12층', bookings: [
    { day: '화', hour: 14, by: '마케팅팀', movable: true },
    { day: '화', hour: 15, by: '마케팅팀', movable: true },
    { day: '금', hour: 10, by: '마케팅팀', movable: true },
  ] },
  { name: '미팅룸 C', capacity: 8, meta: '8인 · 화이트보드', bookings: [
    { day: '화', hour: 15, by: '디자인팀', movable: false },
    { day: '금', hour: 10, by: '디자인팀', movable: false },
  ] },
  { name: '라운지 포커스룸', capacity: 8, meta: '8인 · 8층', bookings: [
    { day: '화', hour: 14, by: '영업팀', movable: false },
    { day: '화', hour: 15, by: '영업팀', movable: false },
    { day: '수', hour: 14, by: '영업팀', movable: false },
    { day: '금', hour: 10, by: '영업팀', movable: false },
  ] },
  { name: '컨퍼런스룸 1', capacity: 10, meta: '10인 · 14층', bookings: [
    { day: '화', hour: 15, by: '인사팀', movable: false },
    { day: '금', hour: 10, by: '인사팀', movable: false },
  ] },
  { name: 'Townhall A', capacity: 12, meta: '12인 · 화상 장비', bookings: [
    { day: '월', hour: 11, by: '전사 공유', movable: false },
    { day: '화', hour: 15, by: '전사 공유', movable: false },
    { day: '금', hour: 10, by: '전사 공유', movable: false },
  ] },
  { name: 'Blue Room', capacity: 4, meta: '4인 · 10층', bookings: [
    { day: '화', hour: 15, by: '개발팀', movable: false },
  ] },
]

export const ATTENDEES: Attendee[] = [
  { id: 'me', name: '나', role: 'host', softPrefs: [] },
  { id: 'sw', name: '김선우', role: 'required', softPrefs: [] },
  { id: 'dh', name: '이도현', role: 'required', softPrefs: [{ type: 'fieldwork', days: ['화', '목'] }] },
  { id: 'mj', name: '박민지', role: 'required', softPrefs: [{ type: 'avoidPostLunch' }] },
  { id: 'hn', name: '정하늘', role: 'optional', softPrefs: [] },
  { id: 'ji', name: '한지우', role: 'optional', softPrefs: [] },
]

// 사람별 소프트 선호 한 줄 설명 (화면 표기용)
export const SOFT_PREF_LABEL: Record<string, string> = {
  dh: '화·목 오전 외근',
  mj: '점심 직후(13시) 회피',
}

export const EVENTS: CalEvent[] = [
  // 나 (host)
  { id: 'e1', ownerId: 'me', day: '월', startHour: 9, endHour: 11, title: '주간 보고', kind: 'fixed' },
  { id: 'e2', ownerId: 'me', day: '화', startHour: 17, endHour: 18, title: '1on1', kind: 'fixed' },
  { id: 'e3', ownerId: 'me', day: '수', startHour: 9, endHour: 11, title: '리뷰', kind: 'fixed' },
  { id: 'e4', ownerId: 'me', day: '수', startHour: 16, endHour: 17, title: '외부 콜', kind: 'fixed' },
  { id: 'e5', ownerId: 'me', day: '금', startHour: 16, endHour: 18, title: '주간 마감', kind: 'fixed' },

  // 김선우 (required) — 화 14시 '팀 리뷰'가 flex(이동 가능): 히어로 조정안 대상
  { id: 'e6', ownerId: 'sw', day: '월', startHour: 16, endHour: 18, title: '고객 미팅', kind: 'fixed' },
  { id: 'e7', ownerId: 'sw', day: '화', startHour: 14, endHour: 15, title: '팀 리뷰', kind: 'flex' },
  { id: 'e8', ownerId: 'sw', day: '수', startHour: 11, endHour: 12, title: '스프린트', kind: 'fixed' },
  { id: 'e9', ownerId: 'sw', day: '수', startHour: 15, endHour: 16, title: '면접', kind: 'fixed' },
  { id: 'e10', ownerId: 'sw', day: '목', startHour: 14, endHour: 16, title: '고객사 방문', kind: 'fixed' },
  { id: 'e11', ownerId: 'sw', day: '금', startHour: 15, endHour: 16, title: '마감 리뷰', kind: 'fixed' },

  // 이도현 (required) — 화·목 오전은 외근(소프트)으로 막힘
  { id: 'e12', ownerId: 'dh', day: '금', startHour: 14, endHour: 15, title: '외부 미팅', kind: 'flex' },
  { id: 'e13', ownerId: 'dh', day: '수', startHour: 17, endHour: 18, title: '마감 작업', kind: 'fixed' },
  { id: 'e14', ownerId: 'dh', day: '목', startHour: 17, endHour: 18, title: '마감 정리', kind: 'fixed' },

  // 박민지 (required) — 매일 점심 직후(13시) 회피(소프트)
  { id: 'e15', ownerId: 'mj', day: '월', startHour: 14, endHour: 16, title: '워크숍', kind: 'fixed' },
  { id: 'e16', ownerId: 'mj', day: '목', startHour: 16, endHour: 17, title: '보고', kind: 'fixed' },
  { id: 'e17', ownerId: 'mj', day: '금', startHour: 11, endHour: 12, title: '정산', kind: 'fixed' },

  // 정하늘 (optional)
  { id: 'e18', ownerId: 'hn', day: '수', startHour: 11, endHour: 12, title: '디자인 싱크', kind: 'fixed' },
  { id: 'e19', ownerId: 'hn', day: '목', startHour: 10, endHour: 12, title: '사용자 인터뷰', kind: 'fixed' },
  { id: 'e20', ownerId: 'hn', day: '금', startHour: 9, endHour: 11, title: '정기 회의', kind: 'fixed' },

  // 한지우 (optional)
  { id: 'e21', ownerId: 'ji', day: '화', startHour: 15, endHour: 17, title: '제작', kind: 'fixed' },
  { id: 'e22', ownerId: 'ji', day: '수', startHour: 14, endHour: 15, title: 'QA', kind: 'fixed' },
  { id: 'e23', ownerId: 'ji', day: '월', startHour: 11, endHour: 12, title: '교육', kind: 'fixed' },
]

// 회의 만들기 기본값 (데모 편의)
export const DEFAULT_DRAFT = {
  title: '3분기 전략 회의',
  agenda: '분기 전략 결정 및 부서별 승인',
  durationHours: 1,
  location: '회의실 B',
}
