import { useEffect, useState } from 'react'
import type { Attendee, CalEvent, Day, Proposal, Slot } from '../types'
import WeekGrid, { type CalcCell, type Ghost, type HighlightInfo, type HighlightTone, type InlineRecommend, type MarkMode } from './WeekGrid'
import DayView from './DayView'
import MonthView from './MonthView'
import type { EventTone, MeetingVisualStatusMap } from './calendarEvents'
import type { RecommendHover } from '../App'

// 패널 헤더 아이덴티티 — 사람(프로필 오브제) vs 회의실(문패형 배지)로 한눈에 구분 (UT §4)
export interface PaneIdentity {
  kind: 'person' | 'room'
  avatarId?: string // 사람: 팀원 id
  badge?: string    // 회의실: 문패(층수 등)
  hideType?: boolean
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

export type PaneCloseTarget = 'person' | 'room'
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
  closeTarget?: PaneCloseTarget // 있으면 패널 우상단에 닫기(X) 버튼 — 주별 캘린더로 복귀
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
  candidateDurationHours?: number
  split?: SplitData | null
  title?: string
  rangeText?: string
  onPickSlot?: (slot: Slot, durationHours?: number) => void
  onPaneAction?: (action: PaneActionType) => void
  onClosePane?: (which: PaneCloseTarget) => void
  eventTone?: EventTone
  meetingStatuses?: MeetingVisualStatusMap
  highlightDurationHours?: number
  durationPickMode?: boolean
  recommends?: InlineRecommend[] | null
  onRecommendHover?: (source: RecommendHover) => void
  calcCells?: CalcCell[] | null
  markerRevealKey?: number
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
  candidateDurationHours = 1,
  split,
  title,
  rangeText,
  onPickSlot,
  onPaneAction,
  onClosePane,
  eventTone = 'muted',
  meetingStatuses,
  highlightDurationHours = 1,
  durationPickMode = false,
  recommends,
  onRecommendHover,
  calcCells,
  markerRevealKey,
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
          <div>
            <div className="title" key={split.title ?? split.day}>{split.title ?? `조정안 미리보기 · ${split.day}요일`}</div>
            <div className="cal-range">{split.note ?? '내 일정과 나란히 확인해요'}</div>
          </div>
        </div>
        <div className="split" data-panes={split.panes.length}>
          {split.panes.map((pane, i) => {
            return (
              <div
                key={pane.title + i}
                className={`split-side ${i === 0 ? 'mine' : 'theirs'}`}
              >
                <DayView attendees={attendees} day={split.day} title={pane.title} identity={pane.identity}
                  events={pane.events} highlight={pane.highlight} highlightInfo={pane.highlightInfo} highlightTone={pane.highlightTone ?? (i === 0 ? 'meeting' : 'reference')}
                  markEventId={pane.markEventId} markMode={pane.markMode} ghost={pane.ghost}
                  markAction={pane.footer} onMarkAction={onPaneAction} eventTone="muted" meetingStatuses={meetingStatuses}
                  onClose={pane.closeTarget ? () => onClosePane?.(pane.closeTarget!) : undefined} />
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
        {view === 'week' && <WeekGrid attendees={attendees} events={events} highlight={highlight} highlightInfo={highlightInfo} highlightTone="meeting" highlightDurationHours={highlightDurationHours} markEventId={markEventId} markMode={markMode} ghost={ghost} candidates={candidates} candidateDurationHours={candidateDurationHours} onPickSlot={onPickSlot} durationPickMode={durationPickMode} eventTone={eventTone} meetingStatuses={meetingStatuses} recommends={recommends} onRecommendHover={onRecommendHover} calcCells={calcCells} markerRevealKey={markerRevealKey} />}
        {view === 'day' && <DayView attendees={attendees} events={events} day={day} setDay={setDay} highlight={highlight} highlightInfo={highlightInfo} highlightTone="meeting" highlightDurationHours={highlightDurationHours} markEventId={markEventId} markMode={markMode} ghost={ghost} candidates={candidates} candidateDurationHours={candidateDurationHours} onPickSlot={onPickSlot} durationPickMode={durationPickMode} eventTone={eventTone} meetingStatuses={meetingStatuses} />}
        {view === 'month' && <MonthView events={events} highlight={highlight} highlightInfo={highlightInfo} onPickDay={(d) => {
          setDay(d)
          setView('day')
          onPickSlot?.({ day: d, hour: highlight?.hour ?? 9 })
        }} eventTone={eventTone} meetingStatuses={meetingStatuses} />}
      </div>
    </div>
  )
}
