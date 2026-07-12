// ── 골든 목업 데이터 v2 ─────────────────────────────────────────
// 목표: 사용자가 '어떤 슬롯을 골라도' ① 사람 캘린더 조정 ② 회의실 예약 조정을
// 반드시 겪게 한다. 기존 "전원 되는 슬롯 0"을 2층(사람+회의실)으로 확장.
//
// v2 골든 5칙:
//  1. 살아있는 38슬롯 전부 차단자는 비호스트 '정확히 1명' (resolveSlot이 단건만 해결)
//  2. 정원 6+ 방 5곳은 살아있는 슬롯 전부 예약 → 빈 방 0. 빈 시간은 월9·금17뿐(=예약 이동 타깃)
//  3. 13시 행의 필참 차단자는 박민지 전용(avoidPostLunch) — 필참 3인은 13시에 이벤트 금지
//     · 12시 행은 특별 취급 없음. 각자의 점심 일정(주인이 요일마다 다름)으로만 막힌다(v6).
//  4. 화·목 오전(9~11)은 이도현 전용(fieldwork) — 그 6칸에 다른 사람 이벤트 금지
//  5. 선택 참석자(하늘·지우) 이벤트는 딱 2칸(월11 지우·수14 하늘) → dropOptional 다양성
//  · 데드 슬롯 2개(월9·금17): 호스트 일정으로 잠가 회의실 이동 타깃을 확보(L3·L4 모순 해소)
// 데이터를 바꾸면 `npm run check`로 전 슬롯 무결성을 재확인할 것.

import type { Attendee, CalEvent, Day, MeetingDraft, Room, RoomBooking } from '../types'
import { DAYS, HOURS } from '../types'

export const TEAM_NAME = '우리 팀'

export const TEAM_TITLES: Record<string, string> = {
  me: '프로덕트 매니저',
  sw: '데이터 분석가',
  dh: '사업 운영 매니저',
  mj: '재무 운영 매니저',
  hn: 'UX 리서처',
  ji: 'QA 매니저',
}

// 회의실은 빈 시간(예약 이동 타깃)이 월9·금17 두 곳뿐 — 그 외엔 정원 6+ 방이 전부 예약됨.
// 이 두 슬롯은 호스트 일정(주간 보고/주간 마감)으로 잠겨 사용자가 회의를 잡을 수 없다(데드 슬롯).
const FREE_ROOM_SLOTS: { day: Day; hour: number }[] = [
  { day: '월', hour: 9 },
  { day: '금', hour: 17 },
]

// 방을 현실적으로 비우는 슬롯 — '추천에 영향 없는' 시간만 고른다(양쪽 구성 모두 사람 2명+ 또는 호스트 잠김).
// 이 빈자리들은 대체로 조정이 필요한 슬롯과 '같은 요일'이라, 회의실 조정 시 자연스러운 이동 타깃이 된다.
// (수15 매직 슬롯과 살아있는 personAsks≤1 슬롯은 여기 없음 → 추천/골든 불변)
const SAFE_FREE_ROOM_SLOTS: { day: Day; hour: number }[] = [
  { day: '월', hour: 15 },
  { day: '화', hour: 10 }, { day: '화', hour: 11 }, { day: '화', hour: 16 },
  { day: '수', hour: 9 },
  { day: '목', hour: 14 }, { day: '목', hour: 15 },
]

// 현실적인 회의실 예약 — 근무시간을 여러 팀의 1~2시간 회의로 채운다(한 팀이 통짜 8시간 X).
// '예약된/빈 슬롯 집합'은 fullWeek과 동일하게 유지(빈 시간은 이동 타깃뿐) → 가용성 로직·골든 불변.
// 팀명(title)만 시각마다 바꿔 인접 시간이 안 병합되게 → 시간표 뷰가 '여러 팀의 짧은 회의'로 보인다.
function busyRoomBookings(teams: string[], movable: boolean, extraFree: { day: Day; hour: number }[] = []): RoomBooking[] {
  const free = [...FREE_ROOM_SLOTS, ...SAFE_FREE_ROOM_SLOTS, ...extraFree]
  const taken = (day: Day, hour: number) => free.some((s) => s.day === day && s.hour === hour)
  const out: RoomBooking[] = []
  let block = 0 // 팀·길이 로테이션 인덱스(요일을 넘어 이어져 인접 블록은 늘 다른 팀)
  for (const day of DAYS) {
    let h = 0
    while (h < HOURS.length) {
      if (taken(day, HOURS[h])) { h++; continue }
      const team = teams[block % teams.length]
      // 길이 1~2h — 다음 칸이 예약 가능한 연속 시각이면 블록마다 번갈아 2h를 섞는다
      const canTwo = h + 1 < HOURS.length && HOURS[h + 1] === HOURS[h] + 1 && !taken(day, HOURS[h + 1])
      const len = canTwo && block % 2 === 1 ? 2 : 1
      for (let k = 0; k < len; k++) out.push({ day, hour: HOURS[h + k], by: team, movable })
      h += len
      block++
    }
  }
  return out
}

// 회의실 — 정원 6+ 5곳은 살아있는 시간대가 대체로 차 있다(방도 조율 자원). Blue Room(4인)은 '인원 초과'.
export const ROOMS: Room[] = [
  // 회의실 B: 전부 movable(유일한 조정 가능 방). v3 — 수15도 비워 '완벽한 시간'의 유일한 빈 방이 됨(매직 슬롯 근거)
  { name: '회의실 B', capacity: 6, meta: '6인 · 12층', bookings: busyRoomBookings(['마케팅팀', '그로스팀', 'PR팀', '콘텐츠팀'], true, [{ day: '수', hour: 15 }]) },
  { name: '미팅룸 C', capacity: 8, meta: '8인 · 화이트보드', bookings: busyRoomBookings(['디자인팀', '브랜드팀', '리서치팀'], false) },
  { name: '라운지 포커스룸', capacity: 8, meta: '8인 · 8층', bookings: busyRoomBookings(['영업팀', 'CS팀', '파트너십팀'], false) },
  { name: '컨퍼런스룸 1', capacity: 10, meta: '10인 · 14층', bookings: busyRoomBookings(['인사팀', '재무팀', '법무팀'], false) },
  { name: 'Townhall A', capacity: 12, meta: '12인 · 화상 장비', bookings: busyRoomBookings(['전사 공유', '부문 타운홀', '교육 세션'], false) },
  { name: 'Blue Room', capacity: 4, meta: '4인 · 10층', bookings: [
    { day: '화', hour: 15, by: '개발팀', movable: false },
    { day: '수', hour: 11, by: '개발팀', movable: false },
    { day: '목', hour: 14, by: '개발팀', movable: false },
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

// v2 주간 차단자 매트릭스대로 재작성 (겹침 없음 · 13시 비움 · 화·목 오전 비움 검증 완료).
// flex는 3개(월10·화14·금14)만 — 나머지는 fixed여도 moveFlex 요청은 생성됨(라벨 차이).
// context는 내 캘린더를 현실감 있게 채우는 표시용 일정으로, 후보 계산에는 영향이 없다.
export const EVENTS: CalEvent[] = [
  // 나 (host) — e1/e2만 실제 차단 일정. context는 캘린더 밀도 보강용.
  { id: 'e1', ownerId: 'me', day: '월', startHour: 9, endHour: 10, title: '주간 보고', kind: 'fixed' },
  { id: 'e2', ownerId: 'me', day: '금', startHour: 17, endHour: 18, title: '주간 마감', kind: 'fixed' },
  { id: 'ctx-me-mon-feedback', ownerId: 'me', day: '월', startHour: 15, endHour: 16, title: '제품 피드백 정리', kind: 'context' },
  { id: 'ctx-me-tue-spec-1', ownerId: 'me', day: '화', startHour: 10, endHour: 11, title: '스펙 정리', kind: 'context' },
  { id: 'ctx-me-tue-spec-2', ownerId: 'me', day: '화', startHour: 11, endHour: 12, title: '스펙 정리', kind: 'context' },
  { id: 'ctx-me-wed-1on1', ownerId: 'me', day: '수', startHour: 9, endHour: 10, title: '1:1 메모 정리', kind: 'context' }, // v3: 매직 슬롯(수15)을 비우려 수9로 이동
  { id: 'ctx-me-thu-roadmap-1', ownerId: 'me', day: '목', startHour: 14, endHour: 15, title: '로드맵 정리', kind: 'context' },
  { id: 'ctx-me-thu-roadmap-2', ownerId: 'me', day: '목', startHour: 15, endHour: 16, title: '로드맵 정리', kind: 'context' },

  // 김선우 (필참) — 화 14시 '팀 리뷰'(flex)가 히어로 조정안
  { id: 'e10', ownerId: 'sw', day: '월', startHour: 10, endHour: 11, title: '데이터 정합성 점검', kind: 'flex' },
  { id: 'e11', ownerId: 'sw', day: '월', startHour: 16, endHour: 17, title: '고객 미팅', kind: 'fixed' },
  { id: 'e12', ownerId: 'sw', day: '화', startHour: 14, endHour: 15, title: '팀 리뷰', kind: 'flex' },
  { id: 'e13', ownerId: 'sw', day: '화', startHour: 17, endHour: 18, title: '지표 리뷰', kind: 'fixed' },
  { id: 'e14', ownerId: 'sw', day: '수', startHour: 9, endHour: 10, title: '스프린트 플래닝', kind: 'fixed' },
  // v3: 수15 '데이터 리뷰' 삭제 → 수15가 전원 가능한 '완벽한 시간'(매직 슬롯)이 됨
  { id: 'e16', ownerId: 'sw', day: '목', startHour: 14, endHour: 16, title: '고객사 방문', kind: 'fixed' }, // 2h — 목 뒤 시간 비어 이동 안전
  { id: 'e17', ownerId: 'sw', day: '금', startHour: 10, endHour: 11, title: '리포트 작성', kind: 'fixed' },
  { id: 'e18', ownerId: 'sw', day: '금', startHour: 15, endHour: 16, title: '마감 리뷰', kind: 'fixed' },

  // 이도현 (필참, 화·목 오전 외근) — 오전 9~11 6칸은 fieldwork가 자동 차단(이벤트 없음)
  { id: 'e20', ownerId: 'dh', day: '월', startHour: 17, endHour: 18, title: '운영 마감', kind: 'fixed' },
  { id: 'e21', ownerId: 'dh', day: '화', startHour: 16, endHour: 17, title: '파트너 미팅', kind: 'fixed' },
  { id: 'e22', ownerId: 'dh', day: '수', startHour: 11, endHour: 12, title: '운영 스탠드업', kind: 'fixed' },
  { id: 'e23', ownerId: 'dh', day: '수', startHour: 17, endHour: 18, title: '마감 작업', kind: 'fixed' },
  { id: 'e24', ownerId: 'dh', day: '목', startHour: 17, endHour: 18, title: '마감 정리', kind: 'fixed' },
  { id: 'e25', ownerId: 'dh', day: '금', startHour: 11, endHour: 12, title: '현장 보고', kind: 'fixed' },
  { id: 'e26', ownerId: 'dh', day: '금', startHour: 14, endHour: 15, title: '외부 미팅', kind: 'flex' },

  // 박민지 (필참, 매일 13시 회피) — 13시엔 본인도 이벤트 없어야 soft가 유지됨
  { id: 'e30', ownerId: 'mj', day: '월', startHour: 14, endHour: 16, title: '재무 워크숍', kind: 'fixed' }, // 2h — 월 뒤 시간 비어 이동 안전
  { id: 'e31', ownerId: 'mj', day: '화', startHour: 15, endHour: 16, title: '월결산 검토', kind: 'fixed' },
  // 화16 = 이도현(파트너 미팅) + 박민지 2인 동시 충돌 → 단건 조정 불가(다자 충돌 케이스 데모용)
  { id: 'e37', ownerId: 'mj', day: '화', startHour: 16, endHour: 17, title: '분기 예산 리뷰', kind: 'fixed' },
  { id: 'e32', ownerId: 'mj', day: '수', startHour: 10, endHour: 11, title: '예산 심의', kind: 'fixed' },
  { id: 'e33', ownerId: 'mj', day: '수', startHour: 16, endHour: 17, title: '지출 결재', kind: 'fixed' },
  { id: 'e34', ownerId: 'mj', day: '목', startHour: 16, endHour: 17, title: '월간 보고', kind: 'fixed' },
  { id: 'e35', ownerId: 'mj', day: '금', startHour: 9, endHour: 10, title: '주간 정산', kind: 'fixed' },
  { id: 'e36', ownerId: 'mj', day: '금', startHour: 16, endHour: 17, title: '주간 마감 정산', kind: 'fixed' },

  // 정하늘 (선택) — 실제 차단은 수14~16(dropOptional) 2칸. 나머지는 context(밀도 보강, 계산 무관)
  // v4(비용 사다리): 인터뷰 14–15 → 14–16 확장. 하늘이 수15를 차단해 '전원 가능 슬롯'을 소멸시킨다.
  //  → 필참 3명이면 하늘(선택)만 걸려 수15 = T0b(매직+부기), 6명 전부 필참이면 하늘=필참 → 수15 = T1.
  { id: 'e40', ownerId: 'hn', day: '수', startHour: 14, endHour: 16, title: '사용자 인터뷰', kind: 'fixed' },
  { id: 'ctx-hn-mon', ownerId: 'hn', day: '월', startHour: 10, endHour: 11, title: '인터뷰 노트 정리', kind: 'context' },
  { id: 'ctx-hn-tue', ownerId: 'hn', day: '화', startHour: 15, endHour: 16, title: '리서치 리뷰', kind: 'context' },
  { id: 'ctx-hn-wed', ownerId: 'hn', day: '수', startHour: 10, endHour: 11, title: '팀 리서치 싱크', kind: 'context' },
  { id: 'ctx-hn-thu', ownerId: 'hn', day: '목', startHour: 15, endHour: 17, title: '사용자 관찰 정리', kind: 'context' }, // 2h
  { id: 'ctx-hn-fri', ownerId: 'hn', day: '금', startHour: 14, endHour: 15, title: 'UT 리포트 작성', kind: 'context' },

  // 한지우 (선택) — 실제 차단은 월11(dropOptional) 1칸. 나머지는 context
  { id: 'e41', ownerId: 'ji', day: '월', startHour: 11, endHour: 12, title: '온보딩 교육', kind: 'fixed' },
  { id: 'ctx-ji-tue', ownerId: 'ji', day: '화', startHour: 10, endHour: 11, title: 'QA 테스트', kind: 'context' },
  // v4: 수15 → 수10로 이동. 6명 전부 필참일 때 context가 flex로 승격돼도(체인 규칙) 수15를
  //     막지 않도록 비운다 → 수15가 '하늘 1명만 조정(T1)'으로 유지된다.
  { id: 'ctx-ji-wed', ownerId: 'ji', day: '수', startHour: 10, endHour: 11, title: '버그 트리아지', kind: 'context' },
  { id: 'ctx-ji-thu', ownerId: 'ji', day: '목', startHour: 10, endHour: 12, title: '릴리스 점검', kind: 'context' }, // 2h
  { id: 'ctx-ji-fri', ownerId: 'ji', day: '금', startHour: 15, endHour: 16, title: 'QA 리포트', kind: 'context' },

  // ── v5: '추천이 추천답게' — 하늘·지우의 실제 일정을 늘려 대부분 슬롯을 2명 조정(T4)으로 만든다.
  // 하늘·지우는 C4에선 선택(제외로 흡수)이라 C4 데모(수15 T0b)는 그대로지만, C6(전원 필참)에선
  // 필참이라 기존 1명 차단자와 겹쳐 그 슬롯이 '2명 조정' T4가 된다 → 추천 대상에서 빠진다.
  // 결과: C6 추천은 수15(T1) + 화14·목13·목17·금10(T3) 5개만 남고, 나머지는 명백히 더 비싼 시간이 된다.
  //  (수15·화14·목13·목17·금10 슬롯엔 하늘·지우 일정을 넣지 않아 '싼 추천'으로 남긴다.)
  { id: 'e50', ownerId: 'hn', day: '월', startHour: 11, endHour: 12, title: '사용자 관찰', kind: 'fixed' },
  { id: 'e51', ownerId: 'hn', day: '월', startHour: 13, endHour: 14, title: '사용자 관찰', kind: 'fixed' },
  { id: 'e52', ownerId: 'hn', day: '월', startHour: 16, endHour: 17, title: '리서치 분석', kind: 'fixed' },
  { id: 'e53', ownerId: 'hn', day: '화', startHour: 9, endHour: 10, title: '심층 인터뷰', kind: 'fixed' },
  { id: 'e54', ownerId: 'hn', day: '화', startHour: 17, endHour: 18, title: '심층 인터뷰', kind: 'fixed' },
  { id: 'e55', ownerId: 'hn', day: '수', startHour: 13, endHour: 14, title: '설문 설계', kind: 'fixed' },
  { id: 'e56', ownerId: 'hn', day: '수', startHour: 17, endHour: 18, title: '설문 설계', kind: 'fixed' },
  { id: 'e57', ownerId: 'hn', day: '금', startHour: 13, endHour: 14, title: 'UT 리포트', kind: 'fixed' },
  { id: 'e60', ownerId: 'ji', day: '월', startHour: 14, endHour: 15, title: '회귀 테스트', kind: 'fixed' },
  { id: 'e61', ownerId: 'ji', day: '월', startHour: 17, endHour: 18, title: '회귀 테스트', kind: 'fixed' },
  { id: 'e62', ownerId: 'ji', day: '화', startHour: 13, endHour: 14, title: '릴리스 검증', kind: 'fixed' },
  { id: 'e63', ownerId: 'ji', day: '수', startHour: 11, endHour: 12, title: '버그 재현', kind: 'fixed' },
  { id: 'e64', ownerId: 'ji', day: '수', startHour: 14, endHour: 15, title: '버그 재현', kind: 'fixed' },
  { id: 'e65', ownerId: 'ji', day: '수', startHour: 16, endHour: 17, title: '버그 재현', kind: 'fixed' },
  { id: 'e66', ownerId: 'ji', day: '목', startHour: 9, endHour: 10, title: '배포 점검', kind: 'fixed' },
  { id: 'e67', ownerId: 'ji', day: '금', startHour: 9, endHour: 10, title: 'QA 싱크', kind: 'fixed' },
  { id: 'e68', ownerId: 'ji', day: '금', startHour: 11, endHour: 12, title: 'QA 싱크', kind: 'fixed' },
  { id: 'e69', ownerId: 'ji', day: '금', startHour: 16, endHour: 17, title: '배포 점검', kind: 'fixed' },

  // ── v6: 12시는 '점심이라 비워둔 시간'이 아니다. 시스템이 모두의 점심을 12시로 가정하지 않고,
  // 각자의 캘린더에 점심 일정이 요일마다 다른 주인으로 들어간다. 그래서 12시도 다른 시간과
  // 똑같이 '누가 무엇을 옮기면 되는가'로만 판정된다(전역 점심 규칙 없음).
  { id: 'e70', ownerId: 'sw', day: '월', startHour: 12, endHour: 13, title: '점심 약속', kind: 'fixed' },
  { id: 'e71', ownerId: 'mj', day: '화', startHour: 12, endHour: 13, title: '팀 점심', kind: 'flex' },
  { id: 'e72', ownerId: 'dh', day: '수', startHour: 12, endHour: 13, title: '점심 약속', kind: 'fixed' },
  { id: 'e73', ownerId: 'sw', day: '목', startHour: 12, endHour: 13, title: '점심 스터디', kind: 'flex' },
  { id: 'e74', ownerId: 'mj', day: '금', startHour: 12, endHour: 13, title: '점심 약속', kind: 'fixed' },
]

// 회의 만들기 기본값 — 순차 입력 공개가 성립하려면 초기값이 비어 있어야 한다.
// (title/agenda는 placeholder로 예시 노출, durationHours·mode는 게이트로 기능)
export const DEFAULT_DRAFT: MeetingDraft = {
  title: '',
  agenda: '',
  durationHours: null,
  mode: null,
  location: '회의실 B', // 회의실 추천 기준값(유지)
}
