import type { ReactNode } from "react";

export function Card({
  title,
  aside,
  className = "",
  children,
}: {
  title: string;
  aside?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`min-w-0 rounded-md border border-slate-300/70 bg-white shadow-sm ${className}`}>
      <div className="flex items-baseline justify-between gap-2 border-b border-slate-200 px-4 py-2.5">
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-slate-800">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}
