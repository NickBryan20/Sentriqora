import type { ReactNode } from 'react';

export type StatusTone = 'healthy' | 'neutral' | 'warning';

export interface StatusBadgeProps {
  children: ReactNode;
  tone?: StatusTone;
}

const toneClasses: Record<StatusTone, string> = {
  healthy: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200',
  neutral: 'border-slate-400/30 bg-slate-400/10 text-slate-200',
  warning: 'border-amber-400/30 bg-amber-400/10 text-amber-100',
};

export function StatusBadge({ children, tone = 'neutral' }: StatusBadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold tracking-wide ${toneClasses[tone]}`}
    >
      {children}
    </span>
  );
}
