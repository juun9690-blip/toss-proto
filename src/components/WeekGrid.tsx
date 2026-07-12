import { useState, type CSSProperties } from 'react'
import type { Attendee, CalEvent, Slot } from '../types'
import { DAYS } from '../types'
import { eventVisualClass, includesEventId, meetingStatusForEvent, mergeContinuousEvents, type EventTone, type MeetingVisualStatusMap } from './calendarEvents'

export interface Ghost { day: string; startHour: number; endHour: number; label: string; variant?: 'move' | 'recommend' }
export interface HighlightInfo { title: string; meta?: string }
export interface InlineRecommend { id: string; slot: Slot; label: string; tone?: 'primary' | 'secondary'; absorbed?: boolean; pulse?: boolean; dIn?: number }
// 계산 연출(후보 소거) 셀 — App이 비용 사다리로 배치·지연을 계산해 넘긴다. WeekGrid는 그리기만.
// 소거 대상(추천 세트가 아닌 빈칸)만 담는다. 추천 세트는 마커가 '그 자리에서' 박스→마커로 모프.
export interface CalcCell { day: string; hour: number; dIn: number; dOut: number; outDur?: number }
export type HighlightTone = 'meeting' | 'reference'
export type MarkMode = 'adjustable' | 'moved' | 'movedOk' | 'concede' | 'conflict' | 'reserved' | 'requestable' | 'moveAsk' | 'attendAsk'

export function markMeta(mode: MarkMode): { label: string } {
  switch (mode) {
    case 'adjustable': return { label: '이동 가능' }
    case 'moved': return { label: '이동됨' }
    case 'movedOk': return { label: '옮기면 가능' }
    case 'concede': return { label: '확인할 시간' }
    case 'conflict': return { label: '참석 어려움' }
    case 'reserved': return { label: '예약 있음' }
    case 'requestable': return { label: '일정 조정 요청' }
    case 'moveAsk': return { label: '옮겨달라는 일정' }
    case 'attendAsk': return { label: '참석 요청받음' }
  }
}

interface Props {
  attendees: Attendee[]
  events: CalEvent[]
  highlight?: Slot | null
  highlightInfo?: HighlightInfo | null
  highlightTone?: HighlightTone
  highlightDurationHours?: number
  markEventId?: string | null
  markMode?: MarkMode
  ghost?: Ghost | null
  candidates?: Slot[]
  candidateDurationHours?: number // 후보 칸 높이 = 옮길 일정의 길이(2시간이면 2칸)
  onPickSlot?: (slot: Slot, durationHours?: number) => void
  durationPickMode?: boolean
  eventTone?: EventTone
  meetingStatuses?: MeetingVisualStatusMap
  recommends?: InlineRecommend[] | null
  onRecommendHover?: (source: 'card' | 'marker' | null) => void
  calcCells?: CalcCell[] | null
  markerRevealKey?: number // 토글 재오픈 때 증가 → 마커 리마운트로 등장 인터랙션 재생
}

const START = 9
const END = 18
const ROW_H = 72
const HOURS = [9, 10, 11, 12, 13, 14, 15, 16, 17]
const DATES: Record<string, string> = { 월: '7.6', 화: '7.7', 수: '7.8', 목: '7.9', 금: '7.10' }
const top = (h: number) => (h - START) * ROW_H
const heightOf = (startHour: number, endHour: number) => top(endHour) - top(startHour) - 2
const durationHeight = (hours: number) => Math.max(ROW_H / 2, ROW_H * hours) - 2
const colHeight = HOURS.length * ROW_H

/** 그 요일의 이동 후보 시작점들을 '연속 구간'으로 묶는다 (HOURS 인덱스 기준).
 *  2칸짜리 일정의 시작점 9시·10시는 서로 겹치지만, 하나의 빈 시간대(9~12)로 묶으면 겹침이 사라진다. */
export function candidateRuns(candidates: Slot[], day: string): { from: number; to: number }[] {
  const idxs = candidates.filter((c) => c.day === day).map((c) => HOURS.indexOf(c.hour)).filter((i) => i >= 0).sort((a, b) => a - b)
  const runs: { from: number; to: number }[] = []
  for (const i of idxs) {
    const last = runs[runs.length - 1]
    if (last && i === last.to + 1) last.to = i
    else runs.push({ from: i, to: i })
  }
  return runs
}
const gridBg = `repeating-linear-gradient(#ffffff, #ffffff ${ROW_H - 1}px, #f2f4f6 ${ROW_H - 1}px, #f2f4f6 ${ROW_H}px)`

export default function WeekGrid({ attendees, events, highlight, highlightInfo, highlightTone = 'meeting', highlightDurationHours = 1, markEventId, markMode = 'adjustable', ghost, candidates, candidateDurationHours = 1, onPickSlot, durationPickMode = false, eventTone = 'muted', meetingStatuses, recommends, onRecommendHover, calcCells, markerRevealKey = 0 }: Props) {
  const nameOf = (id: string) => attendees.find((a) => a.id === id)?.name ?? ''
  const hasCandidates = !!(candidates && candidates.length > 0)
  const renderEvents = mergeContinuousEvents(events)
  // '옮기는 중'인 일정(요청 응답의 주황→초록 블록)은 컬럼이 아니라 주 전체 레이어에 그린다.
  // 목적지를 다른 요일로 바꿔도 같은 노드가 left·top을 함께 보간해 '뚝' 끊기지 않고 미끄러진다.
  const isMovingMode = markMode === 'moveAsk' || markMode === 'movedOk' || markMode === 'moved'
  const movingEvent = isMovingMode ? renderEvents.find((e) => includesEventId(e, markEventId)) : undefined
  const [dragStart, setDragStart] = useState<Slot | null>(null)
  const recommendItems = recommends ?? []
  // 계산 연출 중에는 마커를 '박스 모드'(morphing)로 함께 깔아둔다 — 소거가 끝나면 그 자리에서
  // 점선·라벨이 자연스럽게 생기며 마커로 모프(뿅 생기지 않게). 그래서 숨기지 않고 항상 렌더.
  const scanning = !!(calcCells && calcCells.length > 0)
  const visibleRecommends = recommendItems.filter((item) => !item.absorbed)
  const sameRecommendSlot = (slot: Slot) => recommendItems.some((item) => item.slot.day === slot.day && item.slot.hour === slot.hour)
  const absorbedRecommend = (slot: Slot) => recommendItems.some((item) => item.absorbed && item.slot.day === slot.day && item.slot.hour === slot.hour)
  const pickDuration = (start: Slot, end: Slot) => {
    if (start.day !== end.day) return 2
    const startIndex = HOURS.indexOf(start.hour)
    const endIndex = HOURS.indexOf(end.hour)
    if (startIndex < 0 || endIndex < 0) return 2
    return Math.max(2, Math.abs(endIndex - startIndex) + 1)
  }
  const handlePick = (slot: Slot) => {
    onPickSlot?.(slot, durationPickMode ? 2 : undefined)
  }

  return (
    <div className={`cal2 event-${eventTone} ${onPickSlot && !hasCandidates ? 'pick-mode' : ''} ${hasCandidates ? 'cand-mode' : ''}`}>
      <div className="cal2-corner" />
      {DAYS.map((d) => (
        <div key={d} className="cal2-dayhead">{d}<span>{DATES[d]}</span></div>
      ))}
      <div className="cal2-gutter" style={{ height: colHeight }}>
        {HOURS.map((h) => <div key={h} className="cal2-hour" style={{ height: ROW_H }}>{h}:00</div>)}
      </div>
      {DAYS.map((day) => (
        <div key={day} className="cal2-col" style={{ height: colHeight, backgroundImage: gridBg }}>
          {/* 계산 연출: 내 일정 없는 칸에 후보 박스가 깔렸다 → 비용 사다리 순서로 소거된다(App이 지연 계산) */}
          {calcCells && calcCells.filter((c) => c.day === day).map((c) => (
            <div
              key={`calc-${c.day}-${c.hour}`}
              className="cal2-calc-box"
              style={{ top: top(c.hour) + 3, height: ROW_H - 6, '--d-in': `${c.dIn}ms`, '--d-out': `${c.dOut}ms`, '--out-dur': `${c.outDur ?? 360}ms` } as CSSProperties}
            />
          ))}
          {/* 이동 목적지 — 연속된 시작점을 '빈 시간대' 밴드 하나로 묶는다(2칸 후보끼리 겹치지 않게).
              밴드 안의 각 시작점은 호버하면 실제 들어갈 길이(span)만큼 미리보기가 뜬다. */}
          {onPickSlot && hasCandidates && candidateRuns(candidates!, day).map((run, ri) => {
            const startHour = HOURS[run.from]
            const endExclusive = HOURS[run.to + candidateDurationHours - 1] + 1
            return (
              <div
                key={`candrange-${day}-${startHour}`}
                className="cal2-cand"
                style={{ top: top(startHour), height: heightOf(startHour, endExclusive), animationDelay: `${ri * 60}ms` }}
              >
                {Array.from({ length: run.to - run.from + 1 }, (_, k) => HOURS[run.from + k]).map((h) => (
                  <button
                    key={h}
                    type="button"
                    className="cal2-cand-start"
                    aria-label={`${day} ${h}:00부터 ${candidateDurationHours}시간`}
                    style={{ top: top(h) - top(startHour), height: ROW_H, ['--span-h']: `${heightOf(h, h + candidateDurationHours)}px` } as CSSProperties}
                    onClick={() => onPickSlot({ day, hour: h })}
                  />
                ))}
              </div>
            )
          })}
          {/* 후보가 없을 때만 일반 슬롯 선택(기존 동작) */}
          {onPickSlot && !hasCandidates && HOURS.map((h) => (
            <div
              key={`pick${h}`}
              className={`slotpick ${durationPickMode ? 'duration-pick' : ''}`}
              style={{ top: top(h), height: ROW_H }}
              onClick={() => {
                if (!durationPickMode) handlePick({ day, hour: h })
              }}
              onPointerDown={() => setDragStart({ day, hour: h })}
              onPointerUp={() => {
                if (!dragStart || !durationPickMode) return
                const end = { day, hour: h }
                const durationHours = pickDuration(dragStart, end)
                onPickSlot?.(dragStart, durationHours)
                setDragStart(null)
              }}
            />
          ))}
          {visibleRecommends.filter((item) => item.slot.day === day).map((item) => onPickSlot && (
            <button
              // key에 revealKey 포함 → 토글로 다시 열면 리마운트되어 등장 애니메이션이 재생된다.
              key={`${item.id}-${markerRevealKey}`}
              type="button"
              className={`cal2-rec ${item.tone ?? 'secondary'} ${scanning ? 'morphing' : ''} ${item.pulse ? 'pulse' : ''} ${markerRevealKey > 0 && !scanning ? 'rec-enter' : ''}`}
              style={{ top: top(item.slot.hour), height: ROW_H - 2, '--rec-day': DAYS.indexOf(item.slot.day), '--d-in': `${item.dIn ?? 0}ms` } as CSSProperties}
              onClick={() => onPickSlot(item.slot)}
              onMouseEnter={() => item.tone === 'primary' && onRecommendHover?.('marker')}
              onMouseLeave={() => item.tone === 'primary' && onRecommendHover?.(null)}
              onFocus={() => item.tone === 'primary' && onRecommendHover?.('marker')}
              onBlur={() => item.tone === 'primary' && onRecommendHover?.(null)}
            >
              <span>{item.label}</span>
            </button>
          ))}
          {ghost && ghost.day === day && (
            ghost.variant === 'recommend' && onPickSlot ? (
              // 추천 시간 힌트 — 회의 블럭보다 연한 블럭. 탭하면 그 시간으로 이동(파랑=상호작용).
              <button
                type="button"
                className="cal2-block ghost recommend"
                style={{ top: top(ghost.startHour), height: heightOf(ghost.startHour, ghost.endHour) }}
                onClick={() => onPickSlot({ day, hour: ghost.startHour })}
              >{ghost.label || null}</button>
            ) : (
              <div className={`cal2-block ghost ${ghost.variant ?? ''}`} style={{ top: top(ghost.startHour), height: heightOf(ghost.startHour, ghost.endHour) }}>{ghost.label || null}</div>
            )
          )}
          {renderEvents.filter((e) => e.day === day && e !== movingEvent).map((e) => {
            const marked = includesEventId(e, markEventId)
            const meetingStatus = e.kind === 'meeting' ? meetingStatusForEvent(e, meetingStatuses) : null
            const meetingStateClass = meetingStatus ? (meetingStatus.done ? 'meeting-confirmed' : 'meeting-pending') : ''
            const progress = meetingStatus ? meetingStatus.confirmed / Math.max(1, meetingStatus.total) : 1
            const cls = ['cal2-block', 'ev', e.kind, eventVisualClass(e), meetingStateClass, marked ? markMode : ''].filter(Boolean).join(' ')
            return (
              <div key={e.ids.join('-')} className={cls} style={{ top: top(e.startHour), height: heightOf(e.startHour, e.endHour), '--meeting-progress': progress } as CSSProperties}>
                {meetingStatus && <span className="meeting-fill" aria-hidden="true" />}
                <span className="event-copy">
                  <b>{e.kind === 'meeting' ? e.title : nameOf(e.ownerId)}</b>{e.kind === 'meeting' ? null : ` ${e.title}`}
                  {meetingStatus && <span className="meeting-state-text">{meetingStatus.done ? '참석 확정' : `참석 확인 중 ${meetingStatus.confirmed}/${meetingStatus.total}`}</span>}
                </span>
                {marked && <span className={`adjtag ${markMode}`}>{markMeta(markMode).label}</span>}
              </div>
            )
          })}
        </div>
      ))}
      {/* 회의 블록은 컬럼이 아니라 주(週) 전체를 덮는 레이어에 산다. 요일이 바뀌어도 같은 DOM
          노드로 남아 left가 보간되므로, 월→화 이동이 '뚝 끊기지' 않고 가로로 미끄러진다. */}
      {highlight && (
        <div className="cal2-hi-layer" style={{ height: colHeight }}>
          <div
            className={`cal2-block hi ${highlightInfo ? 'has-detail' : ''} ${highlightTone === 'reference' ? 'reference' : ''} ${absorbedRecommend(highlight) ? 'recommended' : ''}`}
            style={{ top: top(highlight.hour), height: durationHeight(highlightDurationHours), '--d': DAYS.indexOf(highlight.day) } as CSSProperties}
          >
            {highlightInfo ? (
              <>
                <b className="hi-title">{highlightInfo.title}</b>
                {highlightInfo.meta && <span className="hi-meta">{highlightInfo.meta}</span>}
              </>
            ) : highlightTone === 'reference' ? null : '회의'}
            {absorbedRecommend(highlight) && <span className="hi-rec-tag">추천한 시간</span>}
          </div>
        </div>
      )}
      {/* 옮기는 중인 일정 — 목적지를 바꾸면 이 한 노드가 가로(요일)·세로(시각)로 미끄러진다.
          markMode(주황 moveAsk → 초록 movedOk)가 바뀌면 배경색도 같은 자리에서 전이된다. */}
      {movingEvent && (
        <div className="cal2-hi-layer moved" style={{ height: colHeight }}>
          <div
            className={['cal2-block', 'ev', 'cal2-moved', movingEvent.kind, eventVisualClass(movingEvent), markMode].filter(Boolean).join(' ')}
            style={{ top: top(movingEvent.startHour), height: heightOf(movingEvent.startHour, movingEvent.endHour), '--d': DAYS.indexOf(movingEvent.day) } as CSSProperties}
          >
            <span className="event-copy">
              <b>{movingEvent.kind === 'meeting' ? movingEvent.title : nameOf(movingEvent.ownerId)}</b>{movingEvent.kind === 'meeting' ? null : ` ${movingEvent.title}`}
            </span>
            <span className={`adjtag ${markMode}`}>{markMeta(markMode).label}</span>
          </div>
        </div>
      )}
    </div>
  )
}
