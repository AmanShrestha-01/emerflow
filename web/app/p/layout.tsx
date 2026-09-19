import type { Metadata } from "next"

// A patient's private link: never send it on to other sites, never index it.
export const metadata: Metadata = {
  title: "Your visit · EmerFlow",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
}

export default function PatientLinkLayout({ children }: { children: React.ReactNode }) {
  return children
}
