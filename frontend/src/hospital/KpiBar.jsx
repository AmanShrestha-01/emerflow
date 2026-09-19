import { mins } from './format.js'

// Four numbers a newcomer can read at a glance. The rest live in the patient and unit views.
export default function KpiBar({ metrics: m, decisions }) {
  const items = [
    { k: 'Waiting for a bed', v: m.waiting ?? '–', tone: m.critical_waiting > 0 ? 'crit' : '', note: m.critical_waiting > 0 ? `${m.critical_waiting} seriously ill` : null },
    { k: 'Needs your decision', v: decisions, tone: decisions > 0 ? 'you' : '' },
    { k: 'Average wait', v: mins(m.avg_wait), tone: m.avg_wait >= 30 ? 'crit' : '' },
    { k: 'In hallway beds', v: m.hallway ?? '–', tone: '' },
  ]
  return (
    <dl className="kpis" aria-label="Key numbers">
      {items.map((it) => (
        <div key={it.k} className={`kpi${it.tone ? ` kpi-${it.tone}` : ''}`}>
          <dt>{it.k}</dt>
          <dd className="kpi-v">{it.v}</dd>
          {it.note && <dd className="kpi-note">{it.note}</dd>}
        </div>
      ))}
    </dl>
  )
}
