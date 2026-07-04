// ── 핵심 데이터 모델 ────────────────────────────────────────────
// 회의 일정 조율 프로토타입에서 쓰는 타입들.

export type Day = '월' | '화' | '수' | '목' | '금'
export const DAYS: Day[] = ['월', '화', '수', '목', '금']

// 하루 회의 가능 시작시각 (1시간 단위). 12시는 점심이라 제외.
export const HOURS: number[] = [9, 10, 11, 13, 14, 15, 16, 17]

// 한 시간짜리 슬롯 (요일 + 시작시각)
export interface Slot {
  day: Day
  hour: number
}

export type EventKind = 'fixed' | 'flex' // fixed=옮길 수 없음, flex=옮길 수 있음

export interface CalEvent {
  id: string
  ownerId: string
  day: Day
  startHour: number
  endHour: number
  title: string
  kind: EventKind
}

// 소프트 선호: '있으면 좋겠다' 수준의 회피 조건 (강제 차단 아님)
export type SoftPref =
  | { type: 'avoidPostLunch' } // 점심 직후(13시 시작) 회피
  | { type: 'fieldwork'; days: Day[] } // 특정 요일 오전(9~12) 외근

// 회의실 예약 — 다른 팀이 잡아둔 시간. movable이면 협의로 조정 가능.
export interface RoomBooking {
  day: Day
  hour: number
  by: string       // 예약한 팀
  movable: boolean // true면 정말 급하면 조정 요청 가능
}

// 회의실 — 한정 자원(정원 + 이미 예약된 시간표)
export interface Room {
  name: string
  capacity: number
  meta: string
  bookings: RoomBooking[]
}

export type Role = 'host' | 'required' | 'optional'

export interface Attendee {
  id: string
  name: string
  role: Role
  softPrefs: SoftPref[]
}

// 후보 시간 (상태 ②)
export interface Candidate {
  slot: Slot
  tag: 'all' | 'requiredOnly' // 전원 가능 / 필참만 가능
  freeIds: string[]
  missingIds: string[]
  softWarnings: { id: string; reason: string }[]
}

// 조정안 (상태 ③ · 히어로)
export type ProposalAction = 'moveFlex' | 'dropOptional' | 'concedeSoft' | 'moveRoomBooking'

export interface Proposal {
  id: string
  slot: Slot
  action: ProposalAction
  whoId: string // 양보/이동 대상 (사람 id 또는 예약한 팀 이름)
  detail: string // "김선우 님의 '팀 리뷰'를 화 15:00로 이동"
  moveTo?: Slot // moveFlex / moveRoomBooking일 때 이동 위치
  movedEventId?: string
  roomName?: string // moveRoomBooking일 때 확보되는 회의실
  excludeIds?: string[] // 함께 빠지는 선택 인원
  resultText: string // "전원 가능"
  friction: number // 낮을수록 마찰 적음 (정렬용)
  frictionLabel: string // "낮음" | "중간"
}

// 회의 생성 입력 (상태 ①)
export interface MeetingDraft {
  title: string
  agenda: string
  durationHours: number
  location: string
}

export type Level = '낮음' | '보통' | '높음'
export const LEVELS: Level[] = ['낮음', '보통', '높음']

// 화면 상태
export type Screen =
  | 'SETUP'
  | 'CREATE'      // WHAT — 회의 정보(제목·아젠다·길이·장소)
  | 'ATTENDEES'   // WHO — 참석자(필참/선택) + 중요도
  | 'CANDIDATES' // ②후보 + ③조정안 인라인
  | 'REVEAL'     // 조정안 클릭 → 내/상대 캘린더 분할로 납득
  | 'REQUESTING'
  | 'RESPOND'
  | 'CONFIRM'
