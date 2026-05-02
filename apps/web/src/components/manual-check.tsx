'use client';

import { useState, useEffect } from 'react';
import { Play, Zap, Terminal, Download, PauseCircle, Bug, Trash2, Activity, Settings2, RefreshCw } from 'lucide-react';
import { Card } from './ui/card';
import { Button } from './ui/button';
import { useToast } from './ui/toast';
import { api, type CrawlerDebugState } from '@/lib/api';
import type { CrawlerLog } from '@tradeping/types';

export function ManualCheck({ onCheck, compact }: { onCheck: () => void; compact?: boolean }) {
  const { push } = useToast();
  const [running, setRunning] = useState(false);
  const [showLive, setShowLive] = useState(true);
  const [showDebug, setShowDebug] = useState(true);
  const [isPaused, setIsPaused] = useState(false);
  const [logs, setLogs] = useState<CrawlerLog[]>([]);
  const [debugState, setDebugState] = useState<CrawlerDebugState | null>(null);

  const [mockMode, setMockMode] = useState<boolean | null>(null);

  useEffect(() => {
    // Initial fetch for debug toolkit settings
    api.getSettings().then((res) => {
      setMockMode(res.data.crawlerMockOnFetchFail);
    }).catch(() => {});
  }, []);

  const toggleMockMode = async () => {
    if (mockMode === null) return;
    try {
      const res = await api.updateSettings({ crawlerMockOnFetchFail: !mockMode });
      setMockMode(res.data.crawlerMockOnFetchFail);
      push('success', `Mock fallback mode ${!mockMode ? 'ENABLED' : 'DISABLED'}`);
    } catch {
      push('error', 'Failed to update mock mode');
    }
  };

  const forceRefreshPrices = async () => {
    try {
      await api.refreshPrices();
      push('success', 'Prices force-refreshed successfully');
    } catch {
      push('error', 'Failed to refresh prices');
    }
  };

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    if (showLive || showDebug) {
      interval = setInterval(async () => {
        try {
          if (!isPaused && showLive) {
            const res = await api.logs();
            setLogs(res.data.slice(0, 15)); 
          }
          if (showDebug) {
            const debRes = await api.getDebugState();
            setDebugState(debRes.data);
          }
        } catch {}
      }, 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [showLive, showDebug, isPaused]);

  const clearCache = async () => {
    try {
      const res = await api.clearCrawlerCache();
      push('success', res.data.message);
    } catch (err) {
      push('error', (err as Error).message);
    }
  };

  const run = async () => {
    setRunning(true);
    // Don't wait for completion sequentially, fire and let the interval update the stats
    api.runCheck()
      .then((res) => {
        push('success', `Checked ${res.data.count} alert${res.data.count === 1 ? '' : 's'}`);
        onCheck();
      })
      .catch((err) => push('error', (err as Error).message))
      .finally(() => setRunning(false));
  };

  const exportCsv = () => {
    const csvContext = logs.map(l => `${l.timestamp},${l.level},${l.message}`).join('\n');
    const blob = new Blob([csvContext], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'crawler_logs.csv';
    a.click();
    push('success', 'Exported live logs to CSV.');
  };

  const progress = debugState?.progress;
  const progressPct = progress && progress.total > 0 ? (progress.processed / progress.total) * 100 : 0;

  if (compact) {
    return (
      <Button onClick={run} loading={running} variant="secondary">
        <Play className="h-3.5 w-3.5" />
        Run check now
      </Button>
    );
  }

  return (
    <Card>
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10">
              <Zap className="h-4 w-4 text-blue-400" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white">Manual check</h2>
              <p className="text-xs text-white/50">Trigger the crawler immediately for all active alerts.</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={() => { setShowDebug(!showDebug); if (!showLive) setShowLive(true); }} variant="secondary" className="bg-zinc-800">
              <Bug className="h-3.5 w-3.5 text-zinc-400" />
              {showDebug ? 'Hide Debug' : 'Debug'}
            </Button>
            <Button onClick={() => setShowLive(!showLive)} variant="secondary" className="bg-zinc-800">
              <Terminal className="h-3.5 w-3.5 text-zinc-400" />
              {showLive ? 'Hide Logs' : 'Logs'}
            </Button>
            <Button onClick={run} loading={running}>
              <Play className="h-3.5 w-3.5" />
              Run check now
            </Button>
          </div>
        </div>

        {showDebug && debugState && (
          <div className="mt-2 rounded-md bg-zinc-900 border border-amber-900/50 p-4 relative">
             <div className="flex items-center justify-between mb-4 pb-2 border-b border-white/[0.05]">
                <div className="flex items-center gap-2">
                   <Activity className={`h-4 w-4 ${debugState.running ? 'text-emerald-400 animate-pulse' : 'text-zinc-500'}`} />
                   <span className="text-sm font-semibold text-white">Execution Progress & Extreme Debug Toolkit</span>
                </div>
                <div className="flex gap-2">
                   <Button variant="secondary" className={`py-1 h-7 text-xs border ${mockMode ? 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20 hover:bg-indigo-500/20' : 'bg-zinc-800 text-zinc-400 border-zinc-700'}`} onClick={toggleMockMode}>
                      <Settings2 className="h-3 w-3 mr-1" />
                      {mockMode ? 'Mock: ON' : 'Mock: OFF'}
                   </Button>
                   <Button variant="secondary" className="bg-sky-500/10 text-sky-400 hover:bg-sky-500/20 py-1 h-7 text-xs border border-sky-500/20" onClick={forceRefreshPrices}>
                      <RefreshCw className="h-3 w-3 mr-1" />
                      Refresh Data
                   </Button>
                   <Button variant="secondary" className="bg-red-500/10 text-red-400 hover:bg-red-500/20 py-1 h-7 text-xs border border-red-500/20" onClick={clearCache}>
                      <Trash2 className="h-3 w-3 mr-1" />
                      Clear Cache
                   </Button>
                </div>
             </div>
             
             <div className="grid grid-cols-2 gap-4">
                <div>
                   <div className="text-xs text-zinc-400 mb-1">Current Step</div>
                   <div className="text-sm font-mono text-amber-300">
                      {progress?.step || 'IDLE'}
                      {debugState.running && <span className="ml-2 inline-block w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping"></span>}
                   </div>
                   <div className="text-xs text-zinc-500 mt-1">{progress?.message || 'Waiting for execution'}</div>
                </div>
                <div>
                   <div className="text-xs text-zinc-400 mb-1">Evaluation Progress</div>
                   <div className="w-full bg-zinc-800 rounded-full h-2 mt-2">
                     <div 
                        className="bg-emerald-500 h-2 rounded-full transition-all duration-300" 
                        style={{ width: `${progressPct}%` }}
                     ></div>
                   </div>
                   <div className="flex justify-between text-[10px] text-zinc-500 mt-1">
                     <span>{progress?.processed || 0} / {progress?.total || 0} alerts</span>
                     <span>{progress?.currentSymbol || '-'}</span>
                   </div>
                </div>
             </div>

             <div className="grid grid-cols-4 gap-2 mt-4 pt-4 border-t border-white/[0.05]">
                <div className="bg-zinc-950 rounded p-2 text-center">
                   <div className="text-[10px] text-zinc-500 uppercase">Cache Size</div>
                   <div className="text-sm font-mono text-white mt-0.5">{debugState.cacheSize}</div>
                </div>
                <div className="bg-zinc-950 rounded p-2 text-center">
                   <div className="text-[10px] text-zinc-500 uppercase">Page Object</div>
                   <div className="text-sm font-mono text-white mt-0.5">{debugState.pageCacheReady ? 'Memory' : 'Null'}</div>
                </div>
                <div className="bg-zinc-950 rounded p-2 text-center">
                   <div className="text-[10px] text-zinc-500 uppercase">Market Hours</div>
                   <div className="text-sm font-mono text-white mt-0.5">{debugState.marketHoursMode ? 'Enforced' : 'Off'}</div>
                </div>
                 <div className="bg-zinc-950 rounded p-2 text-center">
                   <div className="text-[10px] text-zinc-500 uppercase">Health</div>
                   <div className={`text-sm font-mono mt-0.5 ${debugState.lastCheckOk ? 'text-emerald-400' : 'text-red-400'}`}>
                     {debugState.lastCheckOk ? 'OK' : 'Error'}
                   </div>
                </div>
             </div>
          </div>
        )}

        {showLive && (
          <div className="mt-4 rounded-md bg-zinc-900 border border-zinc-800 p-3 h-48 overflow-y-auto font-mono text-[11px] text-zinc-300 relative group">
            <div className="sticky top-0 float-right flex gap-2">
              <button onClick={() => setIsPaused(!isPaused)} className="p-1 hover:bg-zinc-800 rounded bg-zinc-950/50 backdrop-blur" title={isPaused ? "Resume feed" : "Pause feed"}>
                {isPaused ? <Play className="h-3.5 w-3.5" /> : <PauseCircle className="h-3.5 w-3.5" />}
              </button>
              <button onClick={exportCsv} className="p-1 hover:bg-zinc-800 rounded bg-zinc-950/50 backdrop-blur" title="Export to CSV">
                <Download className="h-3.5 w-3.5" />
              </button>
            </div>
            {logs.length === 0 ? (
              <span className="text-zinc-500 italic">Waiting for crawler logs...</span>
            ) : (
              logs.map((log) => (
                <div key={log.id} className="py-0.5 whitespace-pre-wrap">
                  <span className="text-zinc-500">{new Date(log.timestamp).toLocaleTimeString()}</span>{' '}
                  <span className={log.level === 'ERROR' ? 'text-red-400' : log.level === 'WARN' ? 'text-amber-400' : 'text-blue-400'}>
                    [{log.level}]
                  </span>{' '}
                  {log.message}
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
