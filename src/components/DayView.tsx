import type { Attendee, CalEvent, Day, Slot } from '../types'
import { DAYS } from '../types'
import { markMeta, type Ghost, type MarkMode } from './WeekGrid'

interface Props {
  attendees: Attendee[]
  events: CalEvent[]
  day: Day
  setDay?: (d: Day) => void
  highlight?: Slot | null
  markEventId?: string | null
  markMode?: MarkMode
  ghost?: Ghost | null
  title?: string
  onPickSlot?: (slot: Slot) => void
}

const START = 9
const END = 18
const ROW_H = 72
const HOURS = [9, 10, 11, 12, 13, 14, 15, 16, 17]
const DATES: Record<string, string> = { 월: '7.6 (월)', 화: '7.7 (화)', 수: '7.8 (수)', 목: '7.9 (목)', 금: '7.10 (금)' }
const top = (h: number) => (h - START) * ROW_H
const colHeight = (END - START) * ROW_H
const gridBg = `repeating-linear-gradient(#ffffff, #ffffff ${ROW_H - 1}px, #f2f4f6 ${ROW_H - 1}px, #f2f4f6 ${ROW_H}px)`

export default function DayView({ attendees, events, day, setDay, highlight, markEventId, markMode = 'adjustable', ghost, title, onPickSlot }: Props) {
  const nameOf = (id: string) => attendees.find((a) => a.id === id)?.name ?? ''
  const idx = DAYS.indexOf(day)
  const dayEvents = events.filter((e) => e.day === day)

  return (
    <div className="day-view">
      {setDay ? (
        <div className="day-nav">
          <button disabled={idx === 0} onClick={() => setDay(DAYS[idx - 1])}>‹</button>
          <div className="day-title">{title ?? DATES[day]}</div>
          <button disabled={idx === DAYS.length - 1} onClick={() => setDay(DAYS[idx + 1])}>›</button>
        </div>
      ) : (
        title && <div className="day-title split-title">{title}</div>
      )}

      <div className="cal2 dayonly">
        <div className="cal2-corner" />
        <div className="cal2-dayhead">{DATES[day]}</div>
        <div className="cal2-gutter" style={{ height: colHeight }}>
          {HOURS.map((h) => <div key={h} className="cal2-hour" style={{ height: ROW_H }}>{h}:00</div>)}
        </div>
        <div className="cal2-col" style={{ height: colHeight, backgroundImage: gridBg }}>
          <div className="cal2-lunch" style={{ top: top(12), height: ROW_H }} />
          {onPickSlot && HOURS.filter((h) => h !== 12).map((h) => (
            <div key={`pick${h}`} className="slotpick" style={{ top: top(h), height: ROW_H }} onClick={() => onPickSlot({ day, hour: h })} />
          ))}
          {highlight && highlight.day === day && (
            <div className="cal2-block hi" style={{ top: top(highlight.hour), height: ROW_H - 2 }}>회의</div>
          )}
          {ghost && ghost.day === day && (
            <div className="cal2-block ghost" style={{ top: top(ghost.startHour), height: (ghost.endHour - ghost.startHour) * ROW_H - 2 }}>{ghost.label}</div>
          )}
          {dayEvents.map((e) => {
            const marked = e.id === markEventId
            const cls = ['cal2-block', 'ev', e.kind, marked ? markMode : ''].filter(Boolean).join(' ')
            return (
              <div key={e.id} className={cls} style={{ top: top(e.startHour), height: (e.endHour - e.startHour) * ROW_H - 2 }}>
                <b>{nameOf(e.ownerId)}</b> {e.title}
                {marked && <span className={`adjtag ${markMode}`}>{markMeta(markMode).label}</span>}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
