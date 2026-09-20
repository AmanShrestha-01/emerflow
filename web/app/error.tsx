"use client"

// Without this, one render-time throw anywhere takes the whole app to Next's default
// "client-side exception" screen — a white page, mid-demo, on every route at once.

import { useEffect } from "react"

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("EmerFlow:", error)
  }, [error])

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="glass w-full max-w-md rounded-3xl p-6 text-center">
        <h1 className="font-heading text-2xl font-bold text-ink">This screen stopped</h1>
        <p className="mt-2 text-[15px] text-ink-soft">
          The hospital itself keeps running on the server. Try this screen again, and if it keeps happening,
          reload the page.
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <button
            onClick={reset}
            className="rounded-full bg-ink px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
          >
            Try again
          </button>
          <button
            onClick={() => window.location.reload()}
            className="rounded-full bg-white/70 px-4 py-2 text-sm font-semibold text-ink ring-1 ring-ink/10 hover:bg-white"
          >
            Reload
          </button>
        </div>
        {error?.digest && <p className="mt-4 text-[11px] text-ink-soft">Reference: {error.digest}</p>}
      </div>
    </main>
  )
}
