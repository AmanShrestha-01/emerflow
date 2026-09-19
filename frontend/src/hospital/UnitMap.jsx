import { useState } from 'react'
import { simTime, UNIT_DEPT, unitLabel } from './format.js'
import { Hint } from './Hints.jsx'

const GROUPS = [
  ['RESUS', 'ER', 'HALLWAY'],
  ['ICU', 'STEPDOWN'],
  ['WARD', 'LOUNGE'],
  ['OR', 'PACU'],
]
// Shown by default: the units a newcomer needs to follow the story.
const CORE = new Set(['ER', 'ICU', 'STEPDOWN', 'WARD', 'OR', 'PACU'])
const FLASH_TAG = { fastlane: 'Fast lane', swarm: 'Agents', fallback: 'Rules' }

export default function UnitMap({ st, patientsById, flashes, onSelect }) {
  const [showAll, setShowAll] = useState(false)
  const byUnit = Object.fromEntries(st.units.map((u) => [u.unit, u]))
  const known = new Set(GROUPS.flat())
  const extra = st.units.filter((u) => !known.has(u.unit)).map((u) => u.unit)
  const groups = extra.length ? [...GROUPS, extra] : GROUPS
  const flashByPid = {}
  const tagIds = new Set() // only the newest flash per unit carries a text tag
  const newestByUnit = {}
  for (const f of flashes) {
    flashByPid[f.pid] = f
    if (!newestByUnit[f.unit] || newestByUnit[f.unit].id < f.id) newestByUnit[f.unit] = f
  }
  for (const f of Object.values(newestByUnit)) tagIds.add(f.id)

  return (
    <section className="zone zone-map" aria-labelledby="map-h">
      <header className="zone-h">
        <div className="zone-title">
          <h2 id="map-h">The hospital</h2>
          <p className="zone-cap">Every square is a bed. A bed glows when an agent moves someone into it.</p>
        </div>
        <Legend />
      </header>
      <Hint id="map">
        Each coloured stripe is a department, like the lines on hospital floors. Amber beds wait on your decision. Click a bed to see who is in it.
      </Hint>
      <div className="map-scroll">
        <div className="map-groups">
          {groups.map((g, gi) => {
            const units = g.map((u) => byUnit[u]).filter((u) => u && (showAll || CORE.has(u.unit) || !known.has(u.unit)))
            if (!units.length) return null
            return (
              <div key={gi} className="mgroup">
                {units.map((u) => (
                  <Unit key={u.unit} u={u} patientsById={patientsById} flashByPid={flashByPid} tagIds={tagIds} onSelect={onSelect} />
                ))}
              </div>
            )
          })}
        </div>
        <div className="map-more">
          <button className="linkbtn" onClick={() => setShowAll((v) => !v)} aria-expanded={showAll}>
            {showAll ? 'Show fewer units' : 'Show resuscitation, hallway overflow and discharge lounge'}
          </button>
        </div>
        <details className="res-drawer">
          <summary>Hospital resources: surgery schedule, CT scanner, blood, nurses</summary>
          <Resources st={st} />
        </details>
      </div>
    </section>
  )
}

function Unit({ u, patientsById, flashByPid, tagIds, onSelect }) {
  const occupants = u.occupants || []
  const reservedFor = u.reserved_for || []
  const occupied = Math.max(u.occupied ?? occupants.length, occupants.length)
  const reserved = Math.max(u.reserved ?? reservedFor.length, reservedFor.length)
  const tiles = []
  for (let i = 0; i < occupied; i++) {
    const pid = occupants[i] || null
    const p = pid ? patientsById[pid] : null
    tiles.push({ kind: p?.state === 'held' ? 'held' : 'occ', pid, p, over: i >= u.beds })
  }
  for (let i = 0; i < reserved; i++) {
    const pid = reservedFor[i] || null
    const p = pid ? patientsById[pid] : null
    tiles.push({ kind: p?.state === 'held' ? 'resheld' : 'res', pid, p, over: occupied + i >= u.beds })
  }
  for (let i = occupied + reserved; i < u.beds; i++) tiles.push({ kind: 'free' })

  const freeN = Math.max(0, u.beds - occupied - reserved)
  const over = occupied > u.beds
  const full = occupied >= u.beds
  const heldN = tiles.filter((t) => t.kind === 'held' || t.kind === 'resheld').length
  const unitFlash = Object.values(flashByPid).some((f) => f.unit === u.unit)
  const dept = UNIT_DEPT[u.unit] || 'OTHER'

  return (
    <div className={`unit dept-${dept}${unitFlash ? ' unit-flash' : ''}`}>
      <div className="stripe">
        <span className="stripe-name">{unitLabel(u.unit)}</span>
      </div>
      <div className="unit-body">
        <p className={`unit-occ${over ? ' over' : full ? ' full' : ''}`}>
          <strong>
            {occupied} of {u.beds} beds
          </strong>
          <span>
            {over ? `, ${occupied - u.beds} over capacity` : freeN ? `, ${freeN} free` : ', full'}
            {reserved ? `, ${reserved} held back` : ''}
          </span>
          {heldN > 0 && <span className="unit-you">{heldN} waiting on you</span>}
          {u.nurses != null && <span className="unit-rn">{u.nurses} nurses</span>}
        </p>
        <div className="tiles">
          {tiles.map((t, i) => {
            const f = t.pid ? flashByPid[t.pid] : null
            const cls = [
              'tile',
              `tile-${t.kind}`,
              t.over ? 'tile-over' : '',
              t.p ? `tsev-${t.p.severity}` : '',
              f ? `tile-flash flash-${f.kind}` : '',
            ].join(' ')
            const label =
              t.kind === 'free'
                ? `${unitLabel(u.unit)} bed ${i + 1}: free`
                : `${unitLabel(u.unit)} bed ${i + 1}: ${t.pid || 'occupied'}${t.p ? `, ${t.p.complaint}` : ''}${t.kind === 'resheld' || t.kind === 'held' ? ', waiting on your decision' : t.kind === 'res' ? ', held back for a patient' : ''}`
            const inner = (
              <>
                {(t.kind === 'held' || t.kind === 'resheld') && <span className="tile-mark" aria-hidden="true">!</span>}
                {f && tagIds.has(f.id) && (
                  <span className="tile-tag">{f.kind === 'held' ? 'Needs you' : f.kind === 'flagged' ? 'Flagged' : FLASH_TAG[f.source] || 'Moved'}</span>
                )}
              </>
            )
            return t.pid ? (
              <button key={i} className={cls} title={label} aria-label={label} onClick={() => onSelect(t.pid)}>
                {inner}
              </button>
            ) : (
              <span key={i} className={cls} title={label} aria-label={label} role="img">
                {inner}
              </span>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function Legend() {
  return (
    <ul className="legend" aria-label="Bed key">
      <li>
        <i className="lg lg-occ" /> occupied
      </li>
      <li>
        <i className="lg lg-free" /> free
      </li>
      <li>
        <i className="lg lg-res" /> held back
      </li>
      <li>
        <i className="lg lg-held" /> waiting on your decision
      </li>
      <li>
        <i className="lg lg-over" /> over capacity
      </li>
    </ul>
  )
}

function Resources({ st }) {
  const blood = st.blood || {}
  const oneg = blood['O-']
  const others = Object.entries(blood).filter(([k]) => k !== 'O-')
  const cases = st.or_cases || []
  const ct = st.ct_queue || []
  const partners = Object.entries(st.partners || {})
  return (
    <div className="res">
      <div className="res-cell res-or dept-OR">
        <h3>Surgery tonight</h3>
        {cases.length === 0 ? (
          <p className="empty">No operations booked.</p>
        ) : (
          <ul>
            {cases.map((c, i) => {
              const id = c.case_id || c.id || `#${i + 1}`
              const kind = c.kind || c.type || ''
              const status = c.status || ''
              return (
                <li key={id} className={`orc orc-${status.replace(/\s/g, '')}`}>
                  <span className="orc-proc">{c.procedure || c.label || c.pid || id}</span>
                  <span className={`orc-kind orc-${kind}`}>{kind === 'elective' ? 'planned' : kind}</span>
                  <span className="orc-when">
                    {status === 'scheduled' && typeof c.start === 'number' ? <span className="time">{simTime(c.start)}</span> : status === 'in progress' ? 'now' : status}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </div>
      <div className="res-cell dept-IMAGING">
        <h3>CT scanner</h3>
        <p className="res-big">{ct.length ? `${ct.length} waiting` : 'Free'}</p>
        <p className="res-small">{ct.length ? `Scanning ${ct[0]}` : 'No one in the queue'}</p>
      </div>
      <div className={`res-cell dept-BLOODBANK${oneg != null && oneg < 6 ? ' low' : ''}`}>
        <h3>O-negative blood</h3>
        <p className="res-big">{oneg ?? '–'} units</p>
        <p className="res-small">{oneg != null && oneg < 6 ? 'Running low' : others.length ? `${others.reduce((a, [, v]) => a + v, 0)} units of other types` : ''}</p>
      </div>
      <div className="res-cell dept-STAFFING">
        <h3>Nurses</h3>
        <p className="res-big">{st.units.reduce((a, u) => a + (u.nurses || 0), 0)} on shift</p>
        <p className="res-small">{st.off_duty_nurses ?? 0} off duty who could come in</p>
      </div>
      <div className="res-cell dept-EMS">
        <h3>Partner hospitals</h3>
        {partners.length ? (
          <ul>
            {partners.map(([k, v]) => (
              <li key={k}>
                {k}: {v} beds
              </li>
            ))}
          </ul>
        ) : (
          <p className="empty">None reported.</p>
        )}
      </div>
    </div>
  )
}
