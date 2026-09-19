"use client"

import { useEffect, useState } from "react"
import type { EdasFeed } from "./cms"

/** Live Maryland ER status through our backend (/api/edas), refreshed every minute. Null until loaded or offline. */
export function useEdas(refreshMs = 60_000): EdasFeed | null {
  const [feed, setFeed] = useState<EdasFeed | null>(null)
  useEffect(() => {
    let off = false
    const load = () =>
      fetch("/api/edas")
        .then((r) => (r.ok ? r.json() : null))
        .then((d: EdasFeed | null) => !off && setFeed(d))
        .catch(() => {})
    load()
    const t = setInterval(load, refreshMs)
    return () => {
      off = true
      clearInterval(t)
    }
  }, [refreshMs])
  return feed
}
