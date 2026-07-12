import planner from '../assets/avatars/planner.png'
import data from '../assets/avatars/data.png'
import operations from '../assets/avatars/operations.png'
import finance from '../assets/avatars/finance.png'
import research from '../assets/avatars/research.png'
import quality from '../assets/avatars/quality.png'

const AVATAR_SOURCES: Record<string, string> = {
  me: planner,
  sw: data,
  dh: operations,
  mj: finance,
  hn: research,
  ji: quality,
}

export default function ProfileAvatar({ id, className = '' }: { id?: string; className?: string }) {
  const src = id ? AVATAR_SOURCES[id] : undefined
  return (
    <div className={`avatar ${className}`.trim()} aria-hidden="true">
      {src && <img src={src} alt="" />}
    </div>
  )
}
