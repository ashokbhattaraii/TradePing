import { cn } from '@/lib/utils';

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('glass glass-hover rounded-2xl p-6 shadow-2xl shadow-black/20', className)}
      {...props}
    />
  );
}
