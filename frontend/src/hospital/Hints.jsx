import { createContext, useCallback, useContext, useMemo, useState } from 'react'

// First-visit hints, one per column. Dismissals are remembered per browser.
const KEY = 'emerflow.hints.dismissed.v1'
const HintCtx = createContext({ isOpen: () => false, dismiss: () => {}, showAll: () => {} })

function load() {
  try {
    return new Set(JSON.parse(window.localStorage.getItem(KEY) || '[]'))
  } catch {
    return new Set()
  }
}
function save(set) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify([...set]))
  } catch {
    /* storage unavailable: hints just reappear next visit */
  }
}

export function HintProvider({ children }) {
  const [dismissed, setDismissed] = useState(load)
  const dismiss = useCallback((id) => {
    setDismissed((prev) => {
      const next = new Set(prev)
      next.add(id)
      save(next)
      return next
    })
  }, [])
  const showAll = useCallback(() => {
    const next = new Set()
    save(next)
    setDismissed(next)
  }, [])
  const value = useMemo(() => ({ isOpen: (id) => !dismissed.has(id), dismiss, showAll }), [dismissed, dismiss, showAll])
  return <HintCtx.Provider value={value}>{children}</HintCtx.Provider>
}

export const useHints = () => useContext(HintCtx)

export function Hint({ id, children }) {
  const { isOpen, dismiss } = useHints()
  if (!isOpen(id)) return null
  return (
    <div className="hint" role="note">
      <p>{children}</p>
      <button className="hint-x" onClick={() => dismiss(id)}>
        Got it
      </button>
    </div>
  )
}
