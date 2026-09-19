import { useState } from 'react'
import { api } from '../api.js'
import { Sev } from './bits.jsx'

export default function RadioInput({ run }) {
  const [text, setText] = useState('')
  const [draft, setDraft] = useState(null)
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)

  const parse = async (e) => {
    e?.preventDefault()
    if (!text.trim() || busy) return
    setBusy(true)
    try {
      const d = await run(() => api.radio(text.trim()))
      setDraft(d)
    } catch {
      /* toast shown by run */
    } finally {
      setBusy(false)
    }
  }
  const confirm = async () => {
    setBusy(true)
    try {
      await run(() => api.confirmRadio(draft.draft_id), (r) => `Added ${r?.incoming ?? draft.patients.length} incoming from radio`)
      setDraft(null)
      setText('')
      setOpen(false)
    } catch {
      /* keep draft so staff can retry */
    } finally {
      setBusy(false)
    }
  }

  if (!open && !draft) {
    return (
      <div className="radio radio-closed">
        <button type="button" className="btn btn-quiet btn-block" onClick={() => setOpen(true)}>
          Add patients by radio
        </button>
      </div>
    )
  }
  return (
    <form className="radio" onSubmit={parse}>
      <label className="radio-l" htmlFor="radio-text">
        Add patients from an ambulance radio call
      </label>
      <textarea
        id="radio-text"
        rows={2}
        autoFocus
        value={text}
        placeholder="bus crash, 12 patients, 3 critical, 10 min out"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) parse(e)
        }}
        disabled={busy && !draft}
      />
      {!draft && (
        <div className="draft-actions">
          <button type="submit" className="btn btn-primary" disabled={!text.trim() || busy}>
            {busy ? 'Reading…' : 'Read the call'}
          </button>
          <button type="button" className="btn btn-quiet" onClick={() => setOpen(false)} disabled={busy}>
            Close
          </button>
        </div>
      )}
      {draft && (
        <div className="draft">
          <div className="draft-h">
            Heard {draft.patients.length} patient{draft.patients.length === 1 ? '' : 's'}. Check before adding them.
          </div>
          <ul className="draft-list">
            {draft.patients.map((p, i) => (
              <li key={i}>
                <Sev n={p.severity} />
                <span className="draft-c">{p.complaint}</span>
                <span className="eta">in {p.eta ?? '?'} min</span>
              </li>
            ))}
          </ul>
          <div className="draft-actions">
            <button type="button" className="btn btn-ok" onClick={confirm} disabled={busy}>
              {busy ? 'Adding…' : `Add ${draft.patients.length} to the queue`}
            </button>
            <button type="button" className="btn btn-quiet" onClick={() => setDraft(null)} disabled={busy}>
              Discard
            </button>
          </div>
        </div>
      )}
    </form>
  )
}
