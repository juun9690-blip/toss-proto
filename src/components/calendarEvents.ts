import type { CalEvent, Day } from '../types'
import { DAYS } from '../types'

export type EventTone = 'muted' | 'colorful'

export interface MeetingVisualStatus {
  confirmed: number
  total: number
  done: boolean
}

export type MeetingVisualStatusMap = Record<string, MeetingVisualStatus>

export interface RenderCalEvent extends CalEvent {
  ids: string[]
}

function dayOrder(day: Day): number {
  return DAYS.indexOf(day)
}

export function mergeContinuousEvents(events: CalEvent[]): RenderCalEvent[] {
  const sorted = [...events].sort((a, b) =>
    dayOrder(a.day) - dayOrder(b.day) ||
    a.startHour - b.startHour ||
    a.ownerId.localeCompare(b.ownerId) ||
    a.title.localeCompare(b.title) ||
    a.kind.localeCompare(b.kind),
  )

  const merged: RenderCalEvent[] = []
  for (const event of sorted) {
    const last = merged[merged.length - 1]
    if (
      last &&
      last.day === event.day &&
      last.ownerId === event.ownerId &&
      last.title === event.title &&
      last.kind === event.kind &&
      last.endHour === event.startHour
    ) {
      last.endHour = event.endHour
      last.ids.push(event.id)
    } else {
      merged.push({ ...event, ids: [event.id] })
    }
  }

  return merged
}

export function includesEventId(event: RenderCalEvent, id?: string | null): boolean {
  return !!id && event.ids.includes(id)
}

export function meetingStatusForEvent(event: RenderCalEvent, statuses?: MeetingVisualStatusMap): MeetingVisualStatus | null {
  if (!statuses) return null
  for (const id of event.ids) {
    const status = statuses[id]
    if (status) return status
  }
  return null
}

export function eventVisualClass(event: CalEvent): string {
  if (event.ownerId.startsWith('room:')) return 'cat-room'
  if (event.title.includes('마감') || event.title.includes('정산')) return 'cat-deadline'
  if (event.title.includes('리뷰') || event.title.includes('보고')) return 'cat-review'
  if (event.title.includes('스펙') || event.title.includes('로드맵')) return 'cat-planning'
  if (event.title.includes('피드백') || event.title.includes('메모')) return 'cat-note'
  return 'cat-work'
}
