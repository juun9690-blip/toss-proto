import type { Attendee, CalEvent, Slot } from '../types'
import { DAYS } from '../types'

export interface Ghost { day: string; startHour: number; endHour: number; label: string }
export interface HighlightInfo { title: string; meta?: string }
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
    case 'requestable': return { label: '조정 요청 가능' }
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
  markEventId?: string | null
  markMode?: MarkMode
  ghost?: Ghost | null
  candidates?: Slot[]
  onPickSlot?: (slot: Slot) => void
}

const START = 9
const END = 18
const ROW_H = 72
const HOURS = [9, 10, 11, 12, 13, 14, 15, 16, 17]
const DATES: Record<string, string> = { 월: '7.6', 화: '7.7', 수: '7.8', 목: '7.9', 금: '7.10' }
const top = (h: number) => (h - START) * ROW_H
const colHeight = (END - START) * ROW_H
const gridBg = `repeating-linear-gradient(#ffffff, #ffffff ${ROW_H - 1}px, #f2f4f6 ${ROW_H - 1}px, #f2f4f6 ${ROW_H}px)`

export default function WeekGrid({ attendees, events, highlight, highlightInfo, highlightTone = 'meeting', markEventId, markMode = 'adjustable', ghost, candidates, onPickSlot }: Props) {
  const nameOf = (id: string) => attendees.find((a) => a.id === id)?.name ?? ''
  const hasCandidates = !!(candidates && candidates.length > 0)

  return (
    <div className="cal2">
      <div className="cal2-corner" />
      {DAYS.map((d) => (
        <div key={d} className="cal2-dayhead">{d}<span>{DATES[d]}</span></div>
      ))}
      <div className="cal2-gutter" style={{ height: colHeight }}>
        {HOURS.map((h) => <div key={h} className="cal2-hour" style={{ height: ROW_H }}>{h}:00</div>)}
      </div>
      {DAYS.map((day) => (
        <div key={day} className="cal2-col" style={{ height: colHeight, backgroundImage: gridBg }}>
          <div className="cal2-lunch" style={{ top: top(12), height: ROW_H }} />
          {/* 이동 목적지 후보(빈 시간)를 강조해 클릭 가능하게 — 재계산 대행 마이크로 인터랙션 */}
          {onPickSlot && hasCandidates && candidates!.map((c, i) => (
            c.day === day ? (
              <div key={`cand-${c.day}-${c.hour}`} className="cal2-cand" style={{ top: top(c.hour), height: ROW_H - 2, animationDelay: `${i * 45}ms` }} onClick={() => onPickSlot(c)}>
              </div>
            ) : null
          ))}
          {/* 후보가 없을 때만 일반 슬롯 선택(기존 동작) */}
          {onPickSlot && !hasCandidates && HOURS.filter((h) => h !== 12).map((h) => (
            <div key={`pick${h}`} className="slotpick" style={{ top: top(h), height: ROW_H }} onClick={() => onPickSlot({ day, hour: h })} />
          ))}
          {highlight && highlight.day === day && (
            <div className={`cal2-block hi ${highlightInfo ? 'has-detail' : ''} ${highlightTone === 'reference' ? 'reference' : ''}`} style={{ top: top(highlight.hour), height: ROW_H - 2 }}>
              {highlightInfo ? (
                <>
                  <b>{highlightInfo.title}</b>
                  {highlightInfo.meta && <span>{highlightInfo.meta}</span>}
                </>
              ) : highlightTone === 'reference' ? null : '회의'}
            </div>
          )}
          {ghost && ghost.day === day && (
            <div className="cal2-block ghost" style={{ top: top(ghost.startHour), height: (ghost.endHour - ghost.startHour) * ROW_H - 2 }}>{ghost.label || null}</div>
          )}
          {events.filter((e) => e.day === day).map((e) => {
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
      ))}
    </div>
  )
}
