export default function RoundedCheck({ className = 'round-check' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M5.5 12.6l4.2 4.1 8.8-9.4" />
    </svg>
  )
}
