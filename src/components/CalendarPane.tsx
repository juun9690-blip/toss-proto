import { useEffect, useState } from 'react'
import type { Attendee, CalEvent, Day, Slot } from '../types'
import WeekGrid, { type Ghost, type MarkMode } from './WeekGrid'
import DayView from './DayView'
import MonthView from './MonthView'

export interface SidePane {
  title: string
  events: CalEvent[]
  highlight?: Slot | null
  markEventId?: string | null
  markMode?: MarkMode
  ghost?: Ghost | null
}
// 2~3개 패널 (내 캘린더 + 사람 + 회의실 시간표)
export interface SplitData { day: Day; panes: SidePane[]; title?: string; note?: string }

interface Props {
  attendees: Attendee[]
  events: CalEvent[]
  highlight?: Slot | null
  markEventId?: string | null
  markMode?: MarkMode
  ghost?: Ghost | null
  split?: SplitData | null
  title?: string
  rangeText?: string
  onPickSlot?: (slot: Slot) => void
}

type View = 'month' | 'week' | 'day'
const VIEW_TITLES: Record<View, string> = {
  month: '2026년 7월',
  week: '다음 주',
  day: '일간 보기',
}

export default function CalendarPane({
  attendees,
  events,
  highlight,
  markEventId,
  markMode,
  ghost,
  split,
  title,
  rangeText,
  onPickSlot,
}: Props) {
  const [view, setView] = useState<View>('week')
  const [day, setDay] = useState<Day>('월')

  useEffect(() => { if (highlight) setDay(highlight.day) }, [highlight])

  // ── 분할 모드: 내 캘린더 + 사람 + 회의실 시간표 (2~3개) ──
  if (split) {
    return (
      <div className="calendar-workspace">
        <div className="cal-head">
          <div className="title">{split.title ?? `조정안 미리보기 · ${split.day}요일`}</div>
          <div className="note">{split.note ?? '내 일정과 나란히 확인해요'}</div>
        </div>
        <div className="split" data-panes={split.panes.length}>
          {split.panes.map((pane, i) => (
            <div key={pane.title + i} className={`split-side ${i === 0 ? 'mine' : 'theirs'}`}>
              <DayView attendees={attendees} day={split.day} title={pane.title}
                events={pane.events} highlight={pane.highlight}
                markEventId={pane.markEventId} markMode={pane.markMode} ghost={pane.ghost} />
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="calendar-workspace">
      <div className="cal-head">
        <div>
          <div className="title">{title ?? `내 캘린더 · ${VIEW_TITLES[view]}`}</div>
          <div className="cal-range">{rangeText ?? '2026년 7월 6일 - 7월 10일'}</div>
        </div>
        <div className="cal-actions">
          <div className="viewtabs">
            {(['month', 'week', 'day'] as View[]).map((v) => (
              <button key={v} className={view === v ? 'active' : ''} onClick={() => setView(v)}>
                {v === 'month' ? '월간' : v === 'week' ? '주간' : '일간'}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="calendar-stage">
        {view === 'week' && <WeekGrid attendees={attendees} events={events} highlight={highlight} markEventId={markEventId} markMode={markMode} ghost={ghost} onPickSlot={onPickSlot} />}
        {view === 'day' && <DayView attendees={attendees} events={events} day={day} setDay={setDay} highlight={highlight} markEventId={markEventId} markMode={markMode} ghost={ghost} onPickSlot={onPickSlot} />}
        {view === 'month' && <MonthView events={events} highlight={highlight} onPickDay={(d) => {
          setDay(d)
          setView('day')
          onPickSlot?.({ day: d, hour: highlight?.hour ?? 9 })
        }} />}
      </div>
    </div>
  )
}
