"use client"

import { Dialog } from "@base-ui/react/dialog"
import { XIcon } from "lucide-react"
import { LoginForm } from "@/components/emer/login-form"

/** "Sign in" button that slides the staff login in from the right side of the screen. */
export function SignInPanel({ className = "" }: { className?: string }) {
  return (
    <Dialog.Root>
      <Dialog.Trigger className={className}>Sign in</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-ink/30 backdrop-blur-[2px] transition-opacity duration-200 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
        <Dialog.Popup className="fixed inset-y-0 right-0 z-50 flex w-[min(440px,100%)] flex-col overflow-y-auto bg-background px-7 pb-8 pt-[max(1.75rem,env(safe-area-inset-top))] shadow-2xl ring-1 ring-ink/10 transition-transform duration-300 ease-out data-[ending-style]:translate-x-full data-[starting-style]:translate-x-full">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-2xl font-bold tracking-tight text-ink">Staff sign in</Dialog.Title>
              <Dialog.Description className="mt-1 text-[15px] text-ink-soft">Your role decides which screen opens.</Dialog.Description>
            </div>
            <Dialog.Close aria-label="Close" className="grid size-9 shrink-0 place-items-center rounded-full text-ink-soft ring-1 ring-ink/10 hover:bg-white hover:text-ink">
              <XIcon className="size-4" />
            </Dialog.Close>
          </div>
          <LoginForm />
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
