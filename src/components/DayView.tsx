import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { Attendee, CalEvent, Day, Slot } from '../types'
import { DAYS } from '../types'
import { candidateRuns, markMeta, type Ghost, type HighlightInfo, type HighlightTone, type MarkMode } from './WeekGrid'
import type { PaneActionType, PaneFooter, PaneIdentity } from './CalendarPane'
import { eventVisualClass, includesEventId, meetingStatusForEvent, mergeContinuousEvents, type EventTone, type MeetingVisualStatusMap } from './calendarEvents'
import ProfileAvatar from './ProfileAvatar'

interface Props {
  attendees: Attendee[]
  events: CalEvent[]
  day: Day
  setDay?: (d: Day) => void
  highlight?: Slot | null
  highlightInfo?: HighlightInfo | null
  highlightTone?: HighlightTone
  highlightDurationHours?: number
  markEventId?: string | null
  markMode?: MarkMode
  ghost?: Ghost | null
  candidates?: Slot[]
  candidateDurationHours?: number
  title?: string
  identity?: PaneIdentity
  onPickSlot?: (slot: Slot, durationHours?: number) => void
  durationPickMode?: boolean
  markAction?: PaneFooter
  onMarkAction?: (action: PaneActionType) => void
  onClose?: () => void
  eventTone?: EventTone
  meetingStatuses?: MeetingVisualStatusMap
}

const START = 9
const END = 18
const ROW_H = 72
const HOURS = [9, 10, 11, 12, 13, 14, 15, 16, 17]
const DATES: Record<string, string> = { 월: '7.6 (월)', 화: '7.7 (화)', 수: '7.8 (수)', 목: '7.9 (목)', 금: '7.10 (금)' }
const top = (h: number) => (h - START) * ROW_H
const heightOf = (startHour: number, endHour: number) => top(endHour) - top(startHour) - 2
const durationHeight = (hours: number) => Math.max(ROW_H / 2, ROW_H * hours) - 2
const colHeight = HOURS.length * ROW_H
const gridBg = `repeating-linear-gradient(#ffffff, #ffffff ${ROW_H - 1}px, #f2f4f6 ${ROW_H - 1}px, #f2f4f6 ${ROW_H}px)`

export default function DayView({ attendees, events, day, setDay, highlight, highlightInfo, highlightTone = 'meeting', highlightDurationHours = 1, markEventId, markMode = 'adjustable', ghost, candidates, candidateDurationHours = 1, title, identity, onPickSlot, durationPickMode = false, markAction, onMarkAction, onClose, eventTone = 'muted', meetingStatuses }: Props) {
  const nameOf = (id: string) => attendees.find((a) => a.id === id)?.name ?? ''
  const hasCandidates = !!(candidates && candidates.length > 0)
  const idx = DAYS.indexOf(day)
  const dayEvents = mergeContinuousEvents(events.filter((e) => e.day === day))
  const [dragStart, setDragStart] = useState<Slot | null>(null)
  // 요일을 넘기면 하루치 컬럼이 통째로 교체된다 — 넘긴 방향으로 들어오게 해서 '뚝 끊김'을 없앤다.
  const prevDay = useRef(day)
  const slideFrom = idx >= DAYS.indexOf(prevDay.current) ? 1 : -1
  useEffect(() => { prevDay.current = day }, [day])
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
    <div className="day-view">
      {setDay ? (
        <div className="day-nav">
          <button disabled={idx === 0} onClick={() => setDay(DAYS[idx - 1])}>‹</button>
          <div className="day-title">{title ?? DATES[day]}</div>
          <button disabled={idx === DAYS.length - 1} onClick={() => setDay(DAYS[idx + 1])}>›</button>
        </div>
      ) : (
        title && (
          <div className="split-head">
            {identity?.kind === 'room' ? (
              <div className="pane-id plate">{identity.badge ?? '룸'}</div>
            ) : identity ? (
              <ProfileAvatar id={identity.avatarId} className="pane-id" />
            ) : null}
            <div className="day-title split-title">{title}</div>
            {onClose && (
              <button type="button" className="pane-close" aria-label={`${title} 닫기`} onClick={onClose}>
                <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M5.5 5.5l9 9M14.5 5.5l-9 9" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
              </button>
            )}
          </div>
        )
      )}

      <div className={`cal2 dayonly event-${eventTone} ${onPickSlot && !hasCandidates ? 'pick-mode' : ''} ${hasCandidates ? 'cand-mode' : ''}`}>
        <div className="cal2-corner" />
        <div className="cal2-dayhead" key={`head-${day}`}>{DATES[day]}</div>
        <div className="cal2-gutter" style={{ height: colHeight }}>
          {HOURS.map((h) => <div key={h} className="cal2-hour" style={{ height: ROW_H }}>{h}:00</div>)}
        </div>
        <div key={day} className="cal2-col day-swap" style={{ height: colHeight, backgroundImage: gridBg, '--slide': slideFrom } as CSSProperties}>
          {/* 이동 목적지 — 주간 뷰와 같은 '빈 시간대' 밴드 시스템(2시간 이상이면 겹침 없이 구간으로) */}
          {onPickSlot && hasCandidates && candidateRuns(candidates!, day).map((run, ri) => {
            const startHour = HOURS[run.from]
            const endExclusive = HOURS[run.to + candidateDurationHours - 1] + 1
            return (
              <div
                key={`candrange-${startHour}`}
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
          {highlight && highlight.day === day && (
            <div className={`cal2-block hi ${highlightInfo ? 'has-detail' : ''} ${highlightTone === 'reference' ? 'reference' : ''}`} style={{ top: top(highlight.hour), height: durationHeight(highlightDurationHours) }}>
              {highlightInfo ? (
                <>
                  <b className="hi-title">{highlightInfo.title}</b>
                  {highlightInfo.meta && <span className="hi-meta">{highlightInfo.meta}</span>}
                </>
              ) : highlightTone === 'reference' ? null : '회의'}
            </div>
          )}
          {ghost && ghost.day === day && (
            <div className={`cal2-block ghost ${ghost.variant ?? ''}`} style={{ top: top(ghost.startHour), height: heightOf(ghost.startHour, ghost.endHour) }}>{ghost.label || null}</div>
          )}
          {dayEvents.map((e, idx) => {
            const marked = includesEventId(e, markEventId)
            const canAct = marked && !!markAction?.action
            const actionLabel = canAct && markAction ? eventActionLabel(markAction.label) : ''
            const meetingStatus = e.kind === 'meeting' ? meetingStatusForEvent(e, meetingStatuses) : null
            const meetingStateClass = meetingStatus ? (meetingStatus.done ? 'meeting-confirmed' : 'meeting-pending') : ''
            const progress = meetingStatus ? meetingStatus.confirmed / Math.max(1, meetingStatus.total) : 1
            const cls = ['cal2-block', 'ev', e.kind, eventVisualClass(e), meetingStateClass, marked ? markMode : '', canAct ? 'has-event-action' : ''].filter(Boolean).join(' ')
            // --i: 분할 패널(theirs)에서 이벤트 블록이 순차로 페이드업하는 스태거 인덱스
            const style = { top: top(e.startHour), height: heightOf(e.startHour, e.endHour), '--i': idx, '--meeting-progress': progress } as CSSProperties
            const content = (
              <>
                {meetingStatus && <span className="meeting-fill" aria-hidden="true" />}
                <span className="event-copy">
                  <b>{e.kind === 'meeting' ? e.title : nameOf(e.ownerId)}</b>{e.kind === 'meeting' ? null : ` ${e.title}`}
                  {meetingStatus && <span className="meeting-state-text">{meetingStatus.done ? '참석 확정' : `참석 확인 중 ${meetingStatus.confirmed}/${meetingStatus.total}`}</span>}
                </span>
                {/* 실행 가능한 이벤트는 칩과 호버 버튼을 하나로 합친 상시 흰색 버튼으로 — 마우스를 올리기
                    전에도 '누를 수 있다'가 보인다(호버하면 파랑으로). 그 외엔 설명용 칩만. */}
                {canAct ? (
                  <span className={`event-action-cta ${markMode}`} aria-hidden="true">{markMeta(markMode).label}</span>
                ) : marked && (
                  <span className={`adjtag ${markMode}`}>{markMeta(markMode).label}</span>
                )}
              </>
            )
            if (canAct) {
              return (
                <div
                  key={e.ids.join('-')}
                  role="button"
                  tabIndex={0}
                  className={cls}
                  style={style}
                  aria-label={`${e.title} ${actionLabel}`}
                  onClick={() => {
                    if (markAction?.action) onMarkAction?.(markAction.action)
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return
                    event.preventDefault()
                    if (markAction?.action) onMarkAction?.(markAction.action)
                  }}
                >
                  {content}
                </div>
              )
            }
            return (
              <div key={e.ids.join('-')} className={cls} style={style}>
                {content}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function eventActionLabel(label: string): string {
  if (label.includes('없이')) return '없이 진행'
  return '요청 보내기'
}
