// Small shared visual pieces.

export function Sev({ n, big }) {
  const v = n || 0
  return (
    <span className={`sev sev-${v}${big ? ' sev-big' : ''}`} title={`Urgency ${v} of 5 (1 is most urgent)`}>
      {v || '?'}
    </span>
  )
}

export function CtIcon() {
  return (
    <span className="ico ico-ct" title="Needs a CT scan" aria-label="Needs a CT scan" role="img">
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="2" />
        <circle cx="8" cy="8" r="2.2" fill="currentColor" />
      </svg>
    </span>
  )
}

export function BloodIcon() {
  return (
    <span className="ico ico-blood" title="Needs blood" aria-label="Needs blood" role="img">
      <svg viewBox="0 0 16 16" width="12" height="14" aria-hidden="true">
        <path d="M8 1.5C8 1.5 3 7.2 3 10.2A5 5 0 0 0 13 10.2C13 7.2 8 1.5 8 1.5z" fill="currentColor" />
      </svg>
    </span>
  )
}
