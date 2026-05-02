'use client';

import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from './ui/button';

export function ConnectionBanner({
  online,
  message,
  onRetry,
}: {
  online: boolean;
  message?: string;
  onRetry?: () => void;
}) {
  if (online) return null;
  return (
    <div
      role="alert"
      className="border-b border-amber-400/30 bg-amber-400/10 px-4 py-2 text-sm text-amber-100 sm:px-6"
    >
      <div className="mx-auto flex max-w-[1500px] flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-300" aria-hidden="true" />
          <span>
            {message ?? 'Backend is unreachable. Live prices and alerts are paused.'}{' '}
            <span className="text-amber-100/70">
              Start the API with{' '}
              <code className="rounded bg-black/30 px-1 py-0.5 font-mono text-xs">
                pnpm --filter @tradeping/api dev
              </code>
              .
            </span>
          </span>
        </div>
        {onRetry && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onRetry}
            className="shrink-0"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            Retry
          </Button>
        )}
      </div>
    </div>
  );
}
