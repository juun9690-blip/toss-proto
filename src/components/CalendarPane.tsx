import { useEffect, useState } from 'react'
import type { Attendee, CalEvent, Day, Proposal, Slot } from '../types'
import WeekGrid, { type Ghost, type HighlightInfo, type HighlightTone, type MarkMode } from './WeekGrid'
import DayView from './DayView'
import MonthView from './MonthView'

// 패널 헤더 아이덴티티 — 사람(아바타 이니셜) vs 회의실(문패형 배지)로 한눈에 구분 (UT §4)
export interface PaneIdentity {
  kind: 'person' | 'room'
  avatar?: string   // 사람: 이니셜
  badge?: string    // 회의실: 문패(층수 등)
}
// 패널 하단 액션 스트립 — "보고 있는 것에 요청한다" (UT §2)
export type PaneActionType =
  | { kind: 'proposal'; proposal: Proposal }
  | { kind: 'confirmRequiredOnly'; slot: Slot; excludedId: string }
export interface PaneFooter {
  label: string
  tone: 'active' | 'muted' | 'danger'
  action?: PaneActionType   // 있으면 패널 전체가 클릭 가능
}

export interface SidePane {
  title: string
  events: CalEvent[]
  highlight?: Slot | null
  highlightInfo?: HighlightInfo | null
  highlightTone?: HighlightTone
  markEventId?: string | null
  markMode?: MarkMode
  ghost?: Ghost | null
  identity?: PaneIdentity
  footer?: PaneFooter
}
// 2~3개 패널 (내 캘린더 + 사람 + 회의실 시간표)
export interface SplitData { day: Day; panes: SidePane[]; title?: string; note?: string }

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
  split?: SplitData | null
  title?: string
  rangeText?: string
  onPickSlot?: (slot: Slot) => void
  onPaneAction?: (action: PaneActionType) => void
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
  highlightInfo,
  markEventId,
  markMode,
  ghost,
  candidates,
  split,
  title,
  rangeText,
  onPickSlot,
  onPaneAction,
}: Props) {
  const [view, setView] = useState<View>('week')
  const [day, setDay] = useState<Day>('월')

  useEffect(() => { if (highlight) setDay(highlight.day) }, [highlight])

  // ── 분할 모드: 내 캘린더 + 사람 + 회의실 시간표 (2~3개) ──
  if (split) {
    return (
      <div className="calendar-workspace">
        <div className="cal-head">
          {/* key 변경 시 제목이 부드럽게 크로스페이드 (좌우 화면이 같은 박자로 전환) */}
          <div className="title" key={split.title ?? split.day}>{split.title ?? `조정안 미리보기 · ${split.day}요일`}</div>
          <div className="note">{split.note ?? '내 일정과 나란히 확인해요'}</div>
        </div>
        <div className="split" data-panes={split.panes.length}>
          {split.panes.map((pane, i) => {
            const clickable = !!pane.footer?.action
            const footerCls = pane.footer ? `has-footer footer-${pane.footer.tone}` : ''
            return (
              <div
                key={pane.title + i}
                className={`split-side ${i === 0 ? 'mine' : 'theirs'} ${footerCls} ${clickable ? 'clickable' : ''}`}
                role={clickable ? 'button' : undefined}
                tabIndex={clickable ? 0 : undefined}
                onClick={clickable ? () => onPaneAction?.(pane.footer!.action!) : undefined}
                onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPaneAction?.(pane.footer!.action!) } } : undefined}
              >
                <DayView attendees={attendees} day={split.day} title={pane.title} identity={pane.identity}
                  events={pane.events} highlight={pane.highlight} highlightInfo={pane.highlightInfo} highlightTone={pane.highlightTone ?? (i === 0 ? 'meeting' : 'reference')}
                  markEventId={pane.markEventId} markMode={pane.markMode} ghost={pane.ghost} />
                {pane.footer && (
                  <div className="pane-footer">
                    <span>{pane.footer.label}</span>
                    {clickable && <em aria-hidden="true">→</em>}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div className="calendar-workspace">
      <div className="cal-head">
        <div>
          <div className="title" key={title ?? view}>{title ?? `내 캘린더 · ${VIEW_TITLES[view]}`}</div>
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
        {view === 'week' && <WeekGrid attendees={attendees} events={events} highlight={highlight} highlightInfo={highlightInfo} highlightTone="meeting" markEventId={markEventId} markMode={markMode} ghost={ghost} candidates={candidates} onPickSlot={onPickSlot} />}
        {view === 'day' && <DayView attendees={attendees} events={events} day={day} setDay={setDay} highlight={highlight} highlightInfo={highlightInfo} highlightTone="meeting" markEventId={markEventId} markMode={markMode} ghost={ghost} onPickSlot={onPickSlot} />}
        {view === 'month' && <MonthView events={events} highlight={highlight} highlightInfo={highlightInfo} onPickDay={(d) => {
          setDay(d)
          setView('day')
          onPickSlot?.({ day: d, hour: highlight?.hour ?? 9 })
        }} />}
      </div>
    </div>
  )
}
