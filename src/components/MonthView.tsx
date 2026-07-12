import type { CSSProperties } from 'react'
import type { CalEvent, Day, Slot } from '../types'
import type { HighlightInfo } from './WeekGrid'
import { eventVisualClass, meetingStatusForEvent, mergeContinuousEvents, type EventTone, type MeetingVisualStatusMap, type RenderCalEvent } from './calendarEvents'

interface Props {
  events: CalEvent[]
  highlight?: Slot | null
  highlightInfo?: HighlightInfo | null
  onPickDay: (d: Day) => void
  eventTone?: EventTone
  meetingStatuses?: MeetingVisualStatusMap
}

// 데모 기준 달: 2026년 7월 (7/1 = 수요일). 조율 주간은 7/6~7/10.
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']
const FIRST_COL = 3
const DAYS_IN_MONTH = 31
const DATE_TO_DAY: Record<number, Day> = { 6: '월', 7: '화', 8: '수', 9: '목', 10: '금' }
const DAY_TO_DATE: Record<string, number> = { 월: 6, 화: 7, 수: 8, 목: 9, 금: 10 }

export default function MonthView({ events, highlight, highlightInfo, onPickDay, eventTone = 'muted', meetingStatuses }: Props) {
  const cells: (number | null)[] = []
  for (let i = 0; i < FIRST_COL; i++) cells.push(null)
  for (let d = 1; d <= DAYS_IN_MONTH; d++) cells.push(d)
  while (cells.length % 7 !== 0) cells.push(null)

  const hiDate = highlight ? DAY_TO_DATE[highlight.day] : null
  const eventsByDate = new Map<number, RenderCalEvent[]>()
  for (const e of mergeContinuousEvents(events)) {
    const date = DAY_TO_DATE[e.day]
    if (!date) continue
    const arr = eventsByDate.get(date) ?? []
    arr.push(e)
    eventsByDate.set(date, arr)
  }

  return (
    <div className={`month-view event-${eventTone}`}>
      <div className="monthgrid">
        {WEEKDAYS.map((w) => <div key={w} className="mh">{w}</div>)}
        {cells.map((d, i) => {
          if (d === null) return <div key={i} className="mcell empty" />
          const inWeek = d >= 6 && d <= 10
          const isHi = d === hiDate
          const dayEvents = eventsByDate.get(d) ?? []
          const cls = ['mcell', inWeek ? 'week' : '', isHi ? 'hi' : ''].filter(Boolean).join(' ')
          return (
            <div key={i} className={cls} onClick={() => inWeek && onPickDay(DATE_TO_DAY[d])} style={{ cursor: inWeek ? 'pointer' : 'default' }}>
              <span className="mdate">{d}</span>
              {isHi && <span className="mev meeting">{highlightInfo?.title ?? '회의'}</span>}
              {dayEvents.map((e, j) => {
                const meetingStatus = e.kind === 'meeting' ? meetingStatusForEvent(e, meetingStatuses) : null
                const meetingStateClass = meetingStatus ? (meetingStatus.done ? 'meeting-confirmed' : 'meeting-pending') : ''
                const progress = meetingStatus ? meetingStatus.confirmed / Math.max(1, meetingStatus.total) : 1
                return <span key={j} className={`mev ${e.kind} ${eventVisualClass(e)} ${meetingStateClass}`} style={{ '--meeting-progress': progress } as CSSProperties}>{e.title}</span>
              })}
            </div>
          )
        })}
      </div>
      <p className="note" style={{ marginTop: 10 }}>
        7/6~7/10 안에서 날짜를 누르면 일간 보기로 확인할 수 있어요.
      </p>
    </div>
  )
}
