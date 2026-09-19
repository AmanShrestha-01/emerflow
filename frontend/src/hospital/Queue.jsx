import { mins, unitLabel, WAIT_TARGET } from './format.js'
import { BloodIcon, CtIcon, Sev } from './bits.jsx'
import RadioInput from './RadioInput.jsx'
import { Hint } from './Hints.jsx'

export default function Queue({ patients, holds, onSelect, run, bare }) {
  const incoming = patients.filter((p) => p.state === 'incoming').sort((a, b) => (a.eta ?? 99) - (b.eta ?? 99))
  // Waiting room: waiting, plus held patients who have no bed yet.
  const waiting = patients
    .filter((p) => p.state === 'waiting' || (p.state === 'held' && !p.unit))
    .sort((a, b) => (a.severity || 9) - (b.severity || 9) || (b.waited || 0) - (a.waited || 0))
  const holdByPid = Object.fromEntries((holds || []).map((h) => [h.pid, h]))

  return (
    <section className="zone zone-queue" aria-labelledby="queue-h">
      <header className="zone-h">
        <div className="zone-title">
          <h2 id="queue-h">Waiting for a bed</h2>
          <p className="zone-cap">Sickest first. The number is how urgent (1 is most).</p>
        </div>
        <span className="zone-count">{incoming.length + waiting.length}</span>
      </header>
      {!bare && <Hint id="queue">
        These patients have no bed yet. The coloured number is urgency, 1 is most urgent. A red wait time is longer than it should be.
      </Hint>}
      <RadioInput run={run} />
      <div className="queue-scroll">
        {incoming.length > 0 && (
        <div className="qsec">
          <h3 className="qsec-h">
            On the way <span>{incoming.length}</span>
          </h3>
          {(
            <ul className="qlist">
              {incoming.map((p) => (
                <Row key={p.pid} p={p} onSelect={onSelect} right={<span className="eta">in {p.eta ?? '?'} min</span>} />
              ))}
            </ul>
          )}
        </div>
        )}
        <div className="qsec">
          <h3 className="qsec-h">
            In the waiting room <span>{waiting.length}</span>
          </h3>
          {waiting.length === 0 ? (
            <p className="empty">Nobody is waiting for a bed.</p>
          ) : (
            <ul className="qlist">
              {waiting.map((p) => {
                const over = (p.waited || 0) > (WAIT_TARGET[p.severity] ?? 60)
                return (
                  <Row
                    key={p.pid}
                    p={p}
                    hold={holdByPid[p.pid]}
                    onSelect={onSelect}
                    right={<span className={`wait${over ? ' wait-over' : ''}`}>{mins(p.waited || 0)}</span>}
                  />
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </section>
  )
}

function Row({ p, hold, right, onSelect }) {
  return (
    <li>
      <button className={`qrow${p.state === 'held' ? ' qrow-held' : ''}`} onClick={() => onSelect(p.pid)}>
        <Sev n={p.severity} />
        <span className="qmain">
          <span className="qtop">
            <span className="qname">{p.name || 'Unnamed'}</span>
            <span className="pid">{p.pid}</span>
          </span>
          <span className="qcomplaint">{p.complaint}</span>
          <span className="qtags">
            {p.needs_ct && <CtIcon />}
            {p.needs_blood && <BloodIcon />}
            {p.retriage && <span className="tag tag-retriage" title="Waited long enough that a nurse should check the urgency again">recheck urgency?</span>}
            {p.state === 'held' && <span className="tag tag-held">Needs you: move to {unitLabel(hold?.to_unit)}</span>}
          </span>
        </span>
        {right}
      </button>
    </li>
  )
}
