import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { calcTimeline, proposalKey, recommendedSlotCosts, requiredCount, type Dispatch, type RecMode, type RecommendHover, type State } from '../App'
import RoundedCheck from '../components/RoundedCheck'
import ProfileAvatar from '../components/ProfileAvatar'
import type { Candidate, Day, Proposal, Slot } from '../types'
import { DAYS, HOURS } from '../types'
import { resolveSlot, teamAvailability, sameSlot, slotEarlier, roomStatuses, availableRooms, recommendRoom, resolveRoom, roomProposalFor, eventsForScheduling, type SlotCost } from '../logic/scheduling'

interface Props {
  state: State
  dispatch: Dispatch
  candidates: Candidate[]
  proposals: Proposal[]
  best: SlotCost | null // 비용 사다리 최소 티어 1건 (T0/T0b=매직 · T1~T3=최소 조정)
  recMode: RecMode
  recommendHover: RecommendHover
  onRecommendHover?: (source: RecommendHover) => void
  onInlineScanChange?: (playing: boolean) => void
  onInlineRecommendVisibilityChange?: (visible: boolean) => void
  onMarkerReveal?: () => void // 추천 목록을 다시 펼칠 때 캘린더 마커 등장 인터랙션을 재생
}

const slotText = (s: Slot) => `${s.day} ${s.hour}:00`
const dayText = (d: Day) => `${d}요일`
const ROOM_FILTERS = ['추천', '소형', '중형', '대형'] as const
type RoomFilter = typeof ROOM_FILTERS[number]
const MEMBER_TABS = ['blocked', 'available', 'all'] as const
type MemberTab = typeof MEMBER_TABS[number]
type AltItem = {
  slot: Slot
  main: string
  label: string
  kind: 'magic' | 'regular'
  linked?: boolean
}

// 계산 연출은 '추천 결과(시나리오)'가 바뀔 때마다 재생한다 — 모두 꼭참석 케이스뿐 아니라
// 참석 구성·다자 충돌 등 다른 케이스로 바뀌어 best가 달라지면 다시 계산되는 느낌을 준다.
// (모듈 레벨 — 화면 왕복 시 리마운트돼도 마지막으로 연출한 시나리오 키를 기억, 같은 케이스면 재생 안 함.
//  페이지 새로고침 때만 초기화)
let lastCalcKey: string | null = null
// 거절 반영 모먼트도 화면 왕복(RESPOND→CANDIDATES 리마운트)을 넘어 '이미 재생한 거절 seq'를 기억한다.
// 타이머가 실제로 진행됐을 때만 소비 표시 → StrictMode 이중호출에도 재생이 유실되지 않는다.
let lastRecalcSeq = 0

export default function CandidatesScreen({ state, dispatch, candidates, proposals, best, recMode, recommendHover, onRecommendHover, onInlineScanChange, onInlineRecommendVisibilityChange, onMarkerReveal }: Props) {
  const { attendees, events, draft } = state
  const participantCount = requiredCount(attendees)
  const chainMode = participantCount >= 5
  // 카드 동작은 필참 수가 아니라 best 티어에서 창발한다: asks 0이면 매직, 그 이상이면 최소 조정.
  const bestIsMagic = best?.asks === 0
  const schedulingEvents = eventsForScheduling(attendees, events)
  const fallbackSlot = state.selectedSlot ?? proposals[0]?.slot ?? best?.slot ?? { day: '화' as Day, hour: 15 }
  const slot = fallbackSlot
  const [memberTab, setMemberTab] = useState<MemberTab>('blocked')
  const [roomFilter, setRoomFilter] = useState<RoomFilter>('추천')
  const [altOpen, setAltOpen] = useState(false)

  // 조정을 한 번이라도 수락/거절해 조율이 시작됐으면 복귀 시 추천 연출을 다시 틀지 않는다.
  // ('다른 시간이 좋아요'로 거절→복귀할 때 계산 연출·추천 마커가 새로 뜨던 문제 수정)
  const coordinationStarted = state.acceptedKeys.length + state.declinedIds.length > 0
  // ── 계산되는 느낌 (labor illusion) — 펼친 목록 안에서만 작게 재생한다.
  // 시나리오 키: 추천 슬롯 + 티어 + 조정 횟수. 이게 달라지면 '다른 케이스'로 보고 연출을 다시 튼다.
  const calcKey = best ? `${state.slotPicked ? 'picked' : 'blind'}-${slot.day}-${slot.hour}-${best.slot.day}-${best.slot.hour}-${best.tier}-${best.asks}` : null
  const [calc, setCalc] = useState<'idle' | 'computing' | 'ready'>(() => state.slotPicked ? 'idle' : coordinationStarted ? 'ready' : (calcKey && calcKey !== lastCalcKey) ? 'idle' : 'ready')
  const [calcStep, setCalcStep] = useState(0) // 0: 팀 확인, 1: 회의실 대조, 2: 찾았어요
  const initialSlotKey = useRef(`${slot.day}-${slot.hour}`).current
  const prevSlotKey = useRef(`${slot.day}-${slot.hour}`)
  // 계산 연출 타이머 — 생성·정리를 이 effect 하나에 묶는다. StrictMode가 setup을 두 번 돌려도
  // 타이머가 함께 재생성되므로 반드시 ready로 끝난다(이전엔 ref+cleanup 분리라 타이머가 유실됐음).
  // 캘린더 스캔(주간 훑고 추천 칸에 착지 ~1.1s)이 답에 내려앉은 뒤 "찾았어요"가 뜨도록 뒤로 뺐다.
  useEffect(() => {
    if (calc !== 'computing') return
    // 접근성: 모션 최소화 선호 시 연출 생략, 마커 즉시(전역 규칙과 동기).
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { setCalc('ready'); return }
    // 멘트는 3번만: 후보 올림 → 지우는 중 → 찾았어요. (지우기 시작 = 캘린더 W1 소거 시작과 동기)
    const t = calcTimeline(draft.mode === 'inperson')
    const timers: number[] = [
      window.setTimeout(() => setCalcStep(1), t.waves[1][0]),
      window.setTimeout(() => setCalcStep(2), t.found),
      window.setTimeout(() => setCalc('ready'), t.ready),
    ]
    return () => timers.forEach((timer) => window.clearTimeout(timer))
  }, [calc, draft.mode])
  const startAltCalc = () => {
    onInlineRecommendVisibilityChange?.(recMode !== 'card')
    // 진행 중 중복만 막고, 'ready'(첫 계산 뒤)에서 다시 부르면(토글 재클릭) 배너 계산을 재생한다
    // — 첫 진입과 토글 클릭의 마이크로 인터랙션을 동일한 상단 배너로 통일.
    if (calc === 'computing') return
    if (calcKey) lastCalcKey = calcKey
    setCalcStep(0)
    setCalc('computing')
  }
  useEffect(() => {
    onInlineScanChange?.(recMode !== 'card' && calc === 'computing')
  }, [calc, onInlineScanChange, recMode])
  useEffect(() => {
    return () => {
      onInlineScanChange?.(false)
      onInlineRecommendVisibilityChange?.(false)
    }
  }, [onInlineRecommendVisibilityChange, onInlineScanChange])
  // 바로 진입(시스템이 시간을 계산해 제시) → 최초 1회 계산 연출을 재생한다 (모드 무관).
  // "계산되어서 시간을 알려준다"는 순간을 상단 배너로 보이게 하고, 완료 시 추천 카드를 펼친다.
  useEffect(() => {
    if (state.slotPicked || coordinationStarted || !best || calc !== 'idle') return
    startAltCalc()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    // 계산 완료 → 추천 카드를 펼쳐 결과를 착지시킨다(카드 쓰는 모드; marker는 캘린더가 담당).
    // 단, 조율 시작 이후(거절 복귀 등)엔 추천을 다시 펼치지 않는다.
    if (calc === 'ready' && !state.slotPicked && !coordinationStarted && recMode !== 'marker') setAltOpen(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calc])
  // 계산 중이면 언제나 상단 배너 하나로 — 첫 진입이든 토글 클릭이든 같은 마이크로 인터랙션.
  const showComputeBanner = calc === 'computing'
  // 토글은 '아 추천 뭐였지?' 하고 다시 펼쳐 보는 것일 뿐 — 계산 연출은 다시 재생하지 않는다(첫 진입 전용).
  const toggleAltOpen = () => {
    setAltOpen((open) => {
      const next = !open
      onInlineRecommendVisibilityChange?.(next && recMode !== 'card') // 목록과 캘린더 마커를 함께 여닫는다
      if (next) onMarkerReveal?.() // 다시 펼칠 때 캘린더 마커가 등장 인터랙션으로 뜬다
      if (!next) onInlineScanChange?.(false)
      return next
    })
  }
  // 추천 멘트를 누르면: 사람·회의실 나란히 보기를 닫고 주별 캘린더로 돌아와 추천을 펼쳐 보여준다.
  const onAltMentClick = () => {
    if (state.conflictFocusId || state.roomFocusName) {
      dispatch({ type: 'CLOSE_PREVIEW', which: 'all' })
      setAltOpen(true)
      onInlineRecommendVisibilityChange?.(recMode !== 'card')
      onMarkerReveal?.()
      return
    }
    toggleAltOpen()
  }
  useEffect(() => {
    const key = `${slot.day}-${slot.hour}`
    if (prevSlotKey.current === key) return
    prevSlotKey.current = key
    setAltOpen(false)
    setCalc(best ? 'idle' : 'ready')
    setCalcStep(0)
    onInlineScanChange?.(false)
    onInlineRecommendVisibilityChange?.(false)
  }, [best, onInlineRecommendVisibilityChange, onInlineScanChange, slot.day, slot.hour])
  // 계산 중 사용자가 다른 슬롯을 고르면 시퀀스를 즉시 종료하고 결과를 보여준다.
  useEffect(() => {
    if (calc === 'computing' && `${slot.day}-${slot.hour}` !== initialSlotKey) setCalc('ready')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slot.day, slot.hour])

  // ── 거절 반영 모먼트 ── 거절(declineSeq 증가)로 복귀한 1회, 기존 계산 배너를 축소 재사용해
  //   '거절을 반영해 다시 계산' → 새 best 마커 착지를 한 호흡으로 연출한다(로직 변경 0, 연출만).
  const [recalcPhase, setRecalcPhase] = useState<0 | 1 | null>(null) // null=꺼짐, 0=계산 중, 1=결과
  const recalcTimers = useRef<number[]>([])
  const endRecalc = () => { // 스킵 규칙 — 아무 조작이나 즉시 종료(마커·목록 정상 표시)
    recalcTimers.current.forEach((t) => window.clearTimeout(t))
    recalcTimers.current = []
    lastRecalcSeq = state.declineSeq
    setRecalcPhase(null)
    onInlineRecommendVisibilityChange?.(recMode !== 'card')
    setAltOpen(true) // 거절 반영 후 추천 목록은 펼쳐서 보여준다
  }
  useEffect(() => {
    if (state.declineSeq < lastRecalcSeq) lastRecalcSeq = state.declineSeq // 홈/재시작 초기화 반영
    if (state.declineSeq <= lastRecalcSeq) return // 새 거절 없음
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      lastRecalcSeq = state.declineSeq
      setRecalcPhase(1)
      onInlineRecommendVisibilityChange?.(recMode !== 'card')
      setAltOpen(true)
      const t = window.setTimeout(() => setRecalcPhase(null), 1600)
      recalcTimers.current = [t]
      return () => window.clearTimeout(t)
    }
    setRecalcPhase(0)
    onInlineRecommendVisibilityChange?.(false) // 0~600ms: 이전 마커 억제(잠깐 없다가 새 자리서 태어남)
    const t1 = window.setTimeout(() => {
      lastRecalcSeq = state.declineSeq // 실제 진행됐을 때만 소비(StrictMode 안전)
      setRecalcPhase(1)
      onInlineRecommendVisibilityChange?.(recMode !== 'card') // 새 best 마커 착지(recLand + 글로우)
    }, 600)
    // 연출이 끝나면 배너가 사라지고 '부담이 적은 시간' 추천 목록이 펼쳐진 채로 등장한다
    const t2 = window.setTimeout(() => { setRecalcPhase(null); setAltOpen(true) }, 2400)
    recalcTimers.current = [t1, t2]
    return () => { window.clearTimeout(t1); window.clearTimeout(t2) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.declineSeq])

  const pick = (next: Partial<Slot>) =>
    dispatch({ type: 'SELECT_SLOT', slot: { day: next.day ?? slot.day, hour: next.hour ?? slot.hour } })
  const setRoom = (name: string) => dispatch({ type: 'SET_DRAFT', draft: { ...draft, location: name } })
  const showRoomSchedule = (name: string, available: boolean) => {
    if (available) setRoom(name)
    dispatch({ type: 'PREVIEW_ROOM', roomName: name })
  }

  // ── 사람(시간) ──
  const avail = teamAvailability(attendees, schedulingEvents, slot)
  const okCount = avail.filter((a) => a.ok).length
  const allOk = okCount === avail.length
  const blockedMembers = avail.filter((a) => !a.ok)
  const availableMembers = avail.filter((a) => a.ok)
  const shownMembers = memberTab === 'all' ? avail : memberTab === 'available' ? availableMembers : blockedMembers
  const optionalMissing = blockedMembers.filter((a) => a.att.role === 'optional')
  const optionalIds = optionalMissing.map((a) => a.att.id)
  const isDeclined = (p: Proposal | null | undefined) => !!p && (state.declinedIds.includes(p.id) || state.declinedIds.includes(proposalKey(p)))
  const isAccepted = (p: Proposal | null | undefined) => !!p && state.acceptedKeys.includes(proposalKey(p))
  const rawPeopleFix = resolveSlot(attendees, schedulingEvents, slot)
  const peopleFixAccepted = isAccepted(rawPeopleFix)
  const requiredBlockers = blockedMembers.filter((a) =>
    a.att.role !== 'optional' && !(peopleFixAccepted && rawPeopleFix?.whoId === a.att.id),
  )
  const requiredReady = requiredBlockers.length === 0
  const peopleFixDeclined = isDeclined(rawPeopleFix)
  const peopleFix = peopleFixDeclined || peopleFixAccepted ? null : rawPeopleFix
  const personHero = !requiredReady && peopleFix && (peopleFix.action === 'moveFlex' || peopleFix.action === 'concedeSoft') ? peopleFix : null
  const peopleHard = !requiredReady && !personHero
  // 내 캘린더에 일정이 있으면(실제 차단이든 context 표시용이든) — 그 시간을 잡으려는 건 대개
  // 착오이므로 다른 시간을 권한다. teamAvailability는 context를 무시하므로 raw events로 직접 판정.
  const hostId = attendees.find((a) => a.role === 'host')?.id ?? 'me'
  const hostHasEvent = events.some((e) => e.ownerId === hostId && e.day === slot.day && slot.hour >= e.startHour && slot.hour < e.endHour)
  // 2인 이상 충돌 — 정책상 조정안을 만들지 않는다(부탁 횟수 비용 함수). 대안 시간으로 우회 안내.
  // 다자 판정·힌트 카운트는 '필참'만 센다 — 선택 동시 차단을 다자 충돌로 오판하지 않게(감사 P2).
  const requiredBlockedCount = blockedMembers.filter((a) => a.att.role === 'required').length
  const multiBlocked = requiredBlockedCount >= 2
  // (자동 열림 트리거 제거) 추천 창은 '첫 진입에 펼침 → 슬롯 바꾸면 닫힘 → 사용자가 다시 펼침'만.
  // 예전엔 다자 충돌·내 일정 슬롯에서 제멋대로 다시 열려 열고 닫힘이 예측되지 않았다.

  // ── 장소 (사람 다음 자원) ──
  const stateRooms = state.rooms
  const needCap = attendees.length
  const roomList = roomStatuses(stateRooms, slot, needCap)
  const freeRooms = availableRooms(stateRooms, slot, needCap)
  const freeRoomExists = freeRooms.length > 0
  const recRoom = recommendRoom(stateRooms, slot, needCap, draft.location)
  const selectedRoomOk = freeRooms.some((r) => r.name === draft.location)
  const roomNeedsSwap = freeRoomExists && !selectedRoomOk
  // 정원이 맞는 방이 하나라도 있으면(비었거나 예약됐거나) 방은 어떻게든 확보 가능
  const capOkRoomExists = roomList.some(({ reason }) => reason !== '인원 초과')
  // 회의 방식 — 온라인/둘 다 가능은 회의실이 하드 게이트가 아니다(온라인 폴백)
  const needsRoom = draft.mode !== 'online' && draft.mode !== 'either'
  const roomReady = !needsRoom || freeRoomExists || selectedRoomOk

  // 추천은 전체 목록이 아니라, 지금 선택한 시간에 의미 있는 회의실만 큐레이션한다.
  const roomStateRank = (item: typeof roomList[number]) => {
    if (item.available) return 0
    if (item.adjustable) return 1
    if (item.reason === '예약됨') return 2
    return 3
  }
  const roomFit = (capacity: number) => Math.max(0, capacity - needCap)
  const rankedRooms = [...roomList].sort((a, b) => {
    const aRecommended = recRoom && a.room.name === recRoom.name ? 0 : 1
    const bRecommended = recRoom && b.room.name === recRoom.name ? 0 : 1
    if (aRecommended !== bRecommended) return aRecommended - bRecommended
    const stateDiff = roomStateRank(a) - roomStateRank(b)
    if (stateDiff !== 0) return stateDiff
    const fitDiff = roomFit(a.room.capacity) - roomFit(b.room.capacity)
    if (fitDiff !== 0) return fitDiff
    return a.room.name.localeCompare(b.room.name)
  })
  const visibleRooms = roomFilter === '추천'
    ? rankedRooms.slice(0, 3)
    : rankedRooms.filter(({ room }) => roomSize(room.capacity) === roomFilter)

  const blocked = peopleHard || (requiredReady && !capOkRoomExists)

  // 추천 시간의 회의실 이름 (비용 스캔에서 방을 못 잡았을 때의 표시용 폴백)
  const slotRoomName = (s: Slot) => {
    const room = recommendRoom(stateRooms, s, needCap, draft.location)
    if (room) return room.name
    return resolveRoom(stateRooms, s, needCap, optionalIds)?.roomName ?? '회의실 확인 필요'
  }

  // 종합 액션 (사람 시간 우선 → 정 안 되면 회의실 예약 조정)
  const goConfirm = () => {
    if (!selectedRoomOk && recRoom) setRoom(recRoom.name)
    dispatch({ type: 'CONFIRM_REQUIRED_ONLY', slot, excludedId: optionalIds[0] ?? null })
  }

  // 하단 고정 확정: 전원 준비 + 회의실 준비됐을 때만 활성 (요청은 이제 패널 풋터가 담당)
  const canConfirm = state.slotPicked && !hostHasEvent && requiredReady && roomReady
  const confirmHint = !state.slotPicked
    ? '시간을 먼저 골라주세요'
    : !requiredReady
    ? '팀원의 일정을 확인하고 조정을 요청해보세요'
    : !roomReady
      ? '예약된 회의실을 눌러 사용 요청을 보내보세요'
      : ''
  // 확정 라벨 장소 — 온라인은 '온라인', 대면은 방, 둘 다는 빈 방 있으면 방·없으면 온라인 폴백
  const confirmLocation = draft.mode === 'online'
    ? '온라인'
    : (freeRoomExists || selectedRoomOk)
      ? (roomNeedsSwap && recRoom ? recRoom.name : draft.location)
      : '온라인'
  // '둘 다 가능'인데 빈 방이 없어 온라인으로 확정되는 경우 — 회의실 조정은 '선택지'로 안내
  const eitherOnlineHint = draft.mode === 'either' && canConfirm && confirmLocation === '온라인'
    ? '회의실을 원하면 예약된 방에 조정을 요청할 수 있어요'
    : ''
  const shownHint = canConfirm ? eitherOnlineHint : confirmHint
  const coordinationActive = state.acceptedKeys.length + state.declinedIds.length > 0

  const rankedRecCosts = recommendedSlotCosts(state, best)
  const currentIsRecommended = state.slotPicked && rankedRecCosts.some((cost) => sameSlot(cost.slot, slot))
  const suppressRecommendationHero = currentIsRecommended || hostHasEvent
  const calcStatus = calcStep === 0
    ? '모든 시간을 후보에 올렸어요'
    : calcStep === 1
      ? '안 되는 시간을 하나씩 지우고 있어요'
      : bestIsMagic ? '모두 되는 시간을 찾았어요' : '가장 부담 적은 시간을 찾았어요'

  // 거절 반영 배너 카피 — 전부 '한 줄'. 서브 라인을 없애 두 줄 넘침을 제거했다.
  //  사람 거절+부탁형은 §0의 핵심 문장("같은 분께 연이어 부탁하지 않아요")을 메인으로 승격.
  const declinedWasPerson = !!state.lastDeclinedWhoId && attendees.some((a) => a.id === state.lastDeclinedWhoId)
  let recalcMain = '거절을 반영해 다시 계산 중이에요'
  if (recalcPhase === 1) {
    if (!declinedWasPerson) recalcMain = '다른 방법을 찾았어요'
    else if (!best) recalcMain = '한 번에 되는 시간이 지금은 없어요'
    else if (best.asks === 0) recalcMain = '조정 없이 되는 시간을 찾았어요'
    else recalcMain = '같은 분께 연이어 부탁하지 않아요'
  }
  const showRecalcBanner = recalcPhase !== null
  // 추천 카드 = 캘린더 마커와 '같은 소스'(recommendedSlotCosts). 항상 같은 시간·순서로 보인다.
  // slotPicked면 지금 보는 시간은 빼서 '다른 대안'만 — 마커 규칙과 동일. 0번(best)만 마커와 hover 연동.
  // 행 라벨은 티어 + 차단 필참자 이름까지(감사 P1 카피 확정본) — 어느 슬롯이 왜 싼지 한눈에.
  const recNameOf = (id: string | null) => attendees.find((a) => a.id === id)?.name ?? '한 명'
  const recRowLabel = (cost: SlotCost): string => {
    switch (cost.tier) {
      case 'T0': return '조정 없이 모두 가능'
      case 'T0b': return '꼭 참석 전원 가능'
      case 'T1': return `${recNameOf(cost.personAskId)} 님 1명 조정`
      case 'T2': return '회의실 조정 1건'
      case 'T3': return `${recNameOf(cost.personAskId)} 님 조정 + 회의실`
      default: return `${cost.personAsks}명 조정`
    }
  }
  const altItems: AltItem[] = rankedRecCosts
    .map((cost, index) => ({ cost, index }))
    .filter(({ cost }) => !(state.slotPicked && sameSlot(cost.slot, slot)))
    .map(({ cost, index }) => {
      const linked = index === 0 && !suppressRecommendationHero
      return {
        slot: cost.slot,
        main: `${slotText(cost.slot)} · ${draft.mode === 'online' ? '온라인' : cost.room?.name ?? slotRoomName(cost.slot)}`,
        label: recRowLabel(cost),
        kind: linked && cost.asks === 0 ? 'magic' as const : 'regular' as const,
        linked,
      }
    })
  // 내 일정이 있는 슬롯에서도 섹션을 유지한다 — '다른 시간을 골라보세요' 힌트와 함께 대안을 보여줘야
  // 하므로(자동 열림 트리거도 hostHasEvent를 포함). 예전엔 여기서 숨겨 서로 모순이었다.
  // 거절 반영 배너 중에는 추천 토글 섹션을 숨긴다 — 배너와 겹쳐 부딪히지 않게(주인공 1개 §5-3).
  const showAltSection = !showComputeBanner && !showRecalcBanner && recMode !== 'marker' && rankedRecCosts.length > 0

  // ② 조정하면 되는 시간 리스트 (스태거 등장)
  const renderAltList = (items: AltItem[]) => (
    <div className="alt-slots">
      {/* 계산 중엔 상단 배너(showComputeBanner)가 담당 — 여긴 결과 목록만. 인라인 로딩 분기 제거. */}
      {items.map((item, i) => {
        const linked = !!item.linked
        return (
          <button
            key={`${item.kind}-${slotText(item.slot)}`}
            className={`alt-slot-button ${item.kind === 'magic' ? 'magic-slot-button' : ''} ${linked ? 'rec-linked' : ''} ${linked && recommendHover === 'marker' ? 'rec-peer-hover' : ''}`}
            style={{ ['--d']: `${i * 60}ms` } as CSSProperties}
            onClick={() => dispatch({ type: 'SELECT_SLOT', slot: item.slot })}
            onMouseEnter={() => linked && onRecommendHover?.('card')}
            onMouseLeave={() => linked && onRecommendHover?.(null)}
            onFocus={() => linked && onRecommendHover?.('card')}
            onBlur={() => linked && onRecommendHover?.(null)}
          >
            <span>{item.main}</span>
            <em>{item.label}</em>
          </button>
        )
      })}
    </div>
  )

  return (
    <div
      className="flow-screen candidates-screen"
      onPointerDownCapture={() => { if (recalcPhase !== null) endRecalc() }} // 연출 중 아무 조작 → 즉시 종료
    >
      <div className="flow-content stack">
        <div className="candidate-title-row">
          <h1>{state.slotPicked ? `${dayText(slot.day)} ${slot.hour}:00에 맞춰볼까요?` : '언제 모이면 좋을까요?'}</h1>
        </div>

        {/* 계산 연출 배너 — 거절 반영(recalc)이 최우선, 없으면 첫 계산(showComputeBanner) */}
        {showRecalcBanner ? (
          <div className="rec-computing" aria-live="polite">
            {recalcPhase === 0 && <span className="rec-computing-dots" aria-hidden="true"><i /><i /><i /></span>}
            <span className="rec-computing-text" key={`recalc-${recalcPhase}`}>{recalcMain}</span>
          </div>
        ) : showComputeBanner && (
          <div className="rec-computing" aria-live="polite">
            <span className="rec-computing-dots" aria-hidden="true"><i /><i /><i /></span>
            <span className="rec-computing-text" key={calcStep}>{calcStatus}</span>
          </div>
        )}

        {/* ① 추천 카드 = 비용 사다리 최소 티어. 펼치면 후보 목록 안에서 차별화되어 보인다. */}
        {showAltSection && (
          <section className="top-alt-section">
            <button className="alt-toggle" onClick={onAltMentClick}>
              <span>{bestIsMagic ? '조정하면 되는 시간도 있어요' : '부담이 가장 적은 시간을 확인해보세요'}</span>
              <span className={`alt-toggle-arrow ${altOpen ? 'open' : ''}`} aria-hidden="true" />
            </button>
            {/* 목록은 항상 마운트하고 grid 0fr↔1fr로 접었다 폈다 — 툭 사라지지 않고 부드럽게 닫힌다 */}
            <div className={`alt-collapse ${altOpen && altItems.length > 0 ? 'open' : ''}`} aria-hidden={!altOpen}>
              <div className="alt-collapse-inner">{renderAltList(altItems)}</div>
            </div>
          </section>
        )}

        {/* 요일·시간 */}
        <section className="check-section time-check-section">
          <div>
            <div className="note" style={{ marginBottom: 5 }}>요일</div>
            <div className="seg">
              {DAYS.map((d) => <button key={d} className={state.slotPicked && slot.day === d ? 'active' : ''} onClick={() => pick({ day: d })}>{d}</button>)}
            </div>
          </div>
          <div>
            <div className="note" style={{ marginBottom: 5 }}>시간</div>
            <div className="row">
              {HOURS.map((h) => (
                <button key={h} className={`timechip ${state.slotPicked && slot.hour === h ? 'active' : ''}`} onClick={() => pick({ hour: h })}>{h}:00</button>
              ))}
            </div>
          </div>
        </section>

        {/* 팀 — 기본은 '안 되는 사람'만, 펼치면 전체 */}
        <section className="check-section team-check-section">
          <div className="spread">
            <h2 style={{ margin: 0 }}>우리 팀</h2>
          </div>
          {!state.slotPicked ? (
            <div className="pick-first">시간을 고르면 팀원들이 되는지 확인해 드릴게요</div>
          ) : (
          <>
          <div className="member-tabs">
            <button className={memberTab === 'blocked' ? 'active' : ''} onClick={() => setMemberTab('blocked')}>
              안 되는 사람 {blockedMembers.length}
            </button>
            <button className={memberTab === 'available' ? 'active' : ''} onClick={() => setMemberTab('available')}>
              가능한 사람 {availableMembers.length}
            </button>
            <button className={memberTab === 'all' ? 'active' : ''} onClick={() => setMemberTab('all')}>
              전체 {avail.length}
            </button>
          </div>

          {shownMembers.length === 0 ? (
            <div className="all-clear">{memberTab === 'blocked' ? '이 시간엔 우리 팀 모두 가능해요' : '표시할 팀원이 없어요'}</div>
          ) : (
            <div className="avail" key={memberTab}>
              {shownMembers.map((a) => {
                const approved = !a.ok && peopleFixAccepted && rawPeopleFix?.whoId === a.att.id
                const rowClass = `avail-item ${a.ok ? '' : 'blocked'} ${approved ? 'accepted' : ''} ${a.status} ${!a.ok && a.att.role === 'optional' ? 'optional-blocked' : ''} ${!a.ok && peopleFixDeclined && rawPeopleFix?.whoId === a.att.id ? 'declined' : ''} ${state.conflictFocusId === a.att.id ? 'active' : ''}`
                const rowContent = (
                  <>
                    <div className="avail-person">
                      <div className="profile-row mini">
                        <ProfileAvatar id={a.att.id} />
                        <div className="profile-copy">
                          <div className="profile-name">
                            <span>{a.att.name}</span>
                            {a.att.role === 'host' && <span className="role-pill host">주최자</span>}
                            {a.att.role === 'required' && <span className="role-pill required">꼭 참석</span>}
                            {a.att.role === 'optional' && <span className="role-pill">선택 참석</span>}
                          </div>
                        </div>
                      </div>
                      {(a.ok || approved) && <span className={`av-ok ${approved ? 'approved' : ''}`}>{approved ? '승인 완료' : '가능'}</span>}
                    </div>
                    {!a.ok && !approved && (
                      <span className="inline-action">
                        {state.conflictFocusId === a.att.id ? '보는 중' : '일정 확인'}
                      </span>
                    )}
                  </>
                )
                if (!a.ok && !approved) {
                  return (
                    <button
                      key={a.att.id}
                      type="button"
                      className={`${rowClass} clickable`}
                      aria-pressed={state.conflictFocusId === a.att.id}
                      onClick={() => dispatch({ type: 'PREVIEW_CONFLICT', attendeeId: a.att.id })}
                    >
                      {rowContent}
                    </button>
                  )
                }
                return (
                  <div key={a.att.id} className={rowClass}>
                    {rowContent}
                  </div>
                )
              })}
            </div>
          )}

          {hostHasEvent ? (
            <p className="section-hint">내 일정이 있는 시간이에요. 다른 시간을 골라보세요.</p>
          ) : peopleHard ? (
            <p className={`section-hint ${peopleFixDeclined ? 'danger' : ''}`}>
              {multiBlocked
                ? `${requiredBlockedCount}명의 일정이 겹치는 시간이에요.`
                : peopleFixDeclined
                  ? '상대방이 일정 조정을 하기 어려운 시간이에요.'
                  : '일정 조정 요청이 필요한 시간이에요.'}
            </p>
          ) : null}
          </>
          )}
        </section>

        {/* 회의실 — 방식에 따라 3분기 (온라인: 한 줄 카드 / 대면: 현행 / 둘 다: 현행 + 폴백 노트) */}
        {draft.mode === 'online' ? (
          <section className="check-section room-check-section">
            <div className="online-room-card">온라인 회의 — 회의실이 필요 없어요</div>
          </section>
        ) : (
        <section className="check-section room-check-section">
          <div className="spread">
            <div>
              <h2 style={{ margin: 0 }}>회의실</h2>
            </div>
          </div>
          {!state.slotPicked ? (
            <div className="pick-first">시간을 고르면 회의실 상태를 확인해 드릴게요</div>
          ) : (
          <>
          <div className="place-filters">
            {ROOM_FILTERS.map((filter) => (
              <button key={filter} className={roomFilter === filter ? 'active' : ''} onClick={() => setRoomFilter(filter)}>
                {filter}
              </button>
            ))}
          </div>
          <div className="room-list">
            {visibleRooms.map(({ room, available, reason, booking }) => {
              const capExceeded = reason === '인원 초과'    // 물리적 제약 → 조정 불가
              const isBooked = !available && !capExceeded    // 다른 팀 예약 → 시간표 확인/요청 가능
              const isActive = available && draft.location === room.name
              const roomFocused = state.roomFocusName === room.name
              const roomDeclined = isBooked && isDeclined(roomProposalFor(room, slot, optionalIds))
              return (
                <button
                  key={room.name}
                  className={`room-option ${isActive ? 'active' : ''} ${isBooked ? 'booked' : ''} ${isBooked && booking?.movable ? 'negotiable' : ''} ${roomDeclined ? 'declined' : ''} ${roomFocused ? 'focused' : ''}`}
                  disabled={capExceeded}
                  onClick={() => showRoomSchedule(room.name, available)}
                >
                  <span>
                    <strong>{room.name}</strong>
                    <small>{room.meta}{booking ? ` · ${booking.by} 예약` : ''}</small>
                  </span>
                  <em>{available ? '가능' : capExceeded ? '인원 초과' : (roomFocused ? '보는 중' : '예약 보기')}</em>
                </button>
              )
            })}
          </div>

          {!capOkRoomExists && <p className="section-hint">이 시간엔 정원이 맞는 회의실이 없어요.</p>}
          </>
          )}
        </section>
        )}

        {/* 조율 결과 — 완료된 요청만 간단히 보여준다. */}
        {coordinationActive && state.approvalNotes.length > 0 && (
          <section className="coordination-status decision-zone">
            <div className="approval-stack">
              {state.approvalNotes.map((note, index) => (
                <div className="approval-line" key={`${note}-${index}`}>
                  <span><RoundedCheck /></span>
                  <p>{note}</p>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      {/* 하단 고정 존 — 요청은 패널이, 확정·뒤로는 여기서 (UT §2·§3, 모든 화면 같은 좌표) */}
      <div className="flow-cta">
        {shownHint && <p className="cta-hint">{shownHint}</p>}
        <div className="action-row">
          <button className="ghost btn-lg" onClick={() => dispatch({ type: 'GOTO', screen: 'ATTENDEES' })}>← 뒤로</button>
          <button className={`primary btn-lg ${canConfirm ? 'cta-ready' : ''}`} disabled={!canConfirm} onClick={goConfirm}>
            {canConfirm ? `이 시간으로 확정 · ${confirmLocation}` : '이 시간으로 확정'}
          </button>
        </div>
      </div>
    </div>
  )
}



function roomSize(capacity: number): Exclude<RoomFilter, '추천'> {
  if (capacity <= 6) return '소형'
  if (capacity <= 8) return '중형'
  return '대형'
}
