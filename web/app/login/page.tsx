"use client"

import { Logo } from "@/components/emer/logo"
import { LoginForm } from "@/components/emer/login-form"

export default function LoginPage() {
  return (
    <main className="relative grid min-h-screen place-items-center px-4 py-10">
      <div className="glass-strong w-full max-w-md rounded-[2rem] p-8">
        <Logo />
        <h1 className="mt-6 font-heading text-3xl font-bold tracking-tight text-ink">Staff login</h1>
        <p className="mt-1 text-[15px] text-ink-soft">Your role decides which screen opens.</p>
        <LoginForm />
      </div>
    </main>
  )
}
