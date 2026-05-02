import { cn } from '@/lib/utils';

type Tone = 'default' | 'success' | 'warn' | 'danger' | 'info';

const toneClasses: Record<Tone, string> = {
  default: 'bg-white/5 text-white/70 border-white/10',
  success: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20',
  warn: 'bg-amber-500/10 text-amber-300 border-amber-500/20',
  danger: 'bg-red-500/10 text-red-300 border-red-500/20',
  info: 'bg-blue-500/10 text-blue-300 border-blue-500/20',
};

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
  dot?: boolean;
}

export function Badge({ className, tone = 'default', dot, children, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-[11px] font-medium uppercase tracking-wider',
        toneClasses[tone],
        className,
      )}
      {...props}
    >
      {dot && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />}
      {children}
    </span>
  );
}
