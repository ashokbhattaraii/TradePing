'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Bell,
  BookMarked,
  ChevronDown,
  ChevronUp,
  Edit2,
  ExternalLink,
  Flame,
  GripVertical,
  List,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Star,
  Trash2,
  TrendingDown,
  TrendingUp,
  X,
} from 'lucide-react';
import { api, type PriceSummary, type Watchlist } from '@/lib/api';
import type { StockAlert } from '@tradeping/types';
import { Button } from './ui/button';
import { Input, Select } from './ui/input';
import { Card } from './ui/card';
import { useToast } from './ui/toast';
import { cn } from '@/lib/utils';

// ── helpers ───────────────────────────────────────────────────────────────────
function compact(v: number) {
  return new Intl.NumberFormat('en-NP', { notation: 'compact', maximumFractionDigits: 1 }).format(v);
}

function stockName(price: PriceSummary | null | undefined): string {
  return price?.name && price.name !== price.symbol ? price.name : '';
}

// ── WatchlistPanel (main export) ──────────────────────────────────────────────
export function WatchlistPanel({
  prices = [],
  alerts = [],
  externalActiveId,
  onActiveIdChange,
  onListsChange,
}: {
  prices?: PriceSummary[];
  alerts?: StockAlert[];
  externalActiveId?: string;
  onActiveIdChange?: (id: string) => void;
  onListsChange?: (lists: Watchlist[]) => void;
}) {
  const { push } = useToast();

  // ── state ──────────────────────────────────────────────────────────────────
  const [lists, setListsInternal] = useState<Watchlist[]>([]);
  const setLists = (updater: Watchlist[] | ((prev: Watchlist[]) => Watchlist[])) => {
    setListsInternal((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      onListsChange?.(next);
      return next;
    });
  };
  const [internalActiveId, setInternalActiveId] = useState<string>('default');
  const activeId = externalActiveId ?? internalActiveId;
  const setActiveId = (id: string) => {
    setInternalActiveId(id);
    onActiveIdChange?.(id);
  };
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [sortBy, setSortBy] = useState<'default' | 'name' | 'price' | 'change'>('default');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [newListName, setNewListName] = useState('');
  const [creatingList, setCreatingList] = useState(false);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [addSymbolDraft, setAddSymbolDraft] = useState('');
  const [addingSymbol, setAddingSymbol] = useState(false);
  const [symbolDropdown, setSymbolDropdown] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [selectedSymbol, setSelectedSymbol] = useState<string>('');
  const addInputRef = useRef<HTMLInputElement>(null);

  // ── data ───────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    try {
      const res = await api.listWatchlists();
      setLists(res.data);
      const currentId = externalActiveId ?? internalActiveId;
      const nextId = res.data.find((l) => l.id === currentId) ? currentId : (res.data[0]?.id ?? 'default');
      if (nextId !== currentId) setActiveId(nextId);
    } catch {
      push('error', 'Failed to load watchlists');
    } finally {
      setLoading(false);
    }
  }, [push, externalActiveId, internalActiveId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { void load(); }, [load]);

  const activeList = useMemo(() => lists.find((l) => l.id === activeId) ?? null, [lists, activeId]);

  // Reset selected symbol when active list changes
  useEffect(() => { setSelectedSymbol(''); }, [activeId]);

  const selectedPrice = useMemo(
    () => (selectedSymbol ? prices.find((p) => p.symbol === selectedSymbol) ?? null : null),
    [selectedSymbol, prices],
  );

  // Enrich symbols with live price data
  const enriched = useMemo(() => {
    if (!activeList) return [];
    return activeList.symbols.map((symbol) => ({
      symbol,
      price: prices.find((p) => p.symbol === symbol) ?? null,
      alerts: alerts.filter((a) => a.symbol === symbol),
    }));
  }, [activeList, prices, alerts]);

  const filtered = useMemo(() => {
    const q = query.trim().toUpperCase();
    let items = q ? enriched.filter((r) => r.symbol.includes(q) || stockName(r.price).toUpperCase().includes(q)) : enriched;
    if (sortBy !== 'default') {
      items = [...items].sort((a, b) => {
        let av = 0, bv = 0;
        if (sortBy === 'name') return sortDir === 'asc' ? a.symbol.localeCompare(b.symbol) : b.symbol.localeCompare(a.symbol);
        if (sortBy === 'price') { av = a.price?.price ?? 0; bv = b.price?.price ?? 0; }
        if (sortBy === 'change') { av = a.price?.changePct ?? 0; bv = b.price?.changePct ?? 0; }
        return sortDir === 'asc' ? av - bv : bv - av;
      });
    }
    return items;
  }, [enriched, query, sortBy, sortDir]);

  // ── stats strip ────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const withPrice = enriched.filter((r) => r.price !== null);
    const gainers = withPrice.filter((r) => (r.price?.change ?? 0) > 0).length;
    const losers = withPrice.filter((r) => (r.price?.change ?? 0) < 0).length;
    const flat = withPrice.length - gainers - losers;
    const totalTurnover = withPrice.reduce((s, r) => s + (r.price?.turnover ?? 0), 0);
    const best = [...withPrice].sort((a, b) => (b.price?.changePct ?? 0) - (a.price?.changePct ?? 0))[0];
    const worst = [...withPrice].sort((a, b) => (a.price?.changePct ?? 0) - (b.price?.changePct ?? 0))[0];
    const activeAlerts = enriched.reduce((s, r) => s + r.alerts.filter((a) => a.status === 'ACTIVE').length, 0);
    return { gainers, losers, flat, totalTurnover, best, worst, activeAlerts, withPrice: withPrice.length };
  }, [enriched]);

  // ── mutations ──────────────────────────────────────────────────────────────
  const createList = async () => {
    const name = newListName.trim();
    if (!name) return;
    setCreatingList(true);
    try {
      const res = await api.createWatchlist(name);
      setLists((prev) => [...prev, res.data]);
      setActiveId(res.data.id);
      setNewListName('');
    } catch (err) {
      push('error', (err as Error).message);
    } finally {
      setCreatingList(false);
    }
  };

  const deleteList = async (id: string) => {
    try {
      await api.deleteWatchlist(id);
      setLists((prev) => {
        const next = prev.filter((l) => l.id !== id);
        if (activeId === id) setActiveId(next[0]?.id ?? 'default');
        return next;
      });
    } catch (err) {
      push('error', (err as Error).message);
    }
  };

  const saveRename = async () => {
    if (!renameId || !renameDraft.trim()) { setRenameId(null); return; }
    try {
      const res = await api.renameWatchlist(renameId, renameDraft.trim());
      setLists((prev) => prev.map((l) => (l.id === renameId ? res.data : l)));
    } catch (err) {
      push('error', (err as Error).message);
    } finally {
      setRenameId(null);
    }
  };

  const addSymbol = async () => {
    const sym = addSymbolDraft.trim().toUpperCase();
    if (!sym || !activeId) return;
    setAddingSymbol(true);
    try {
      const res = await api.addToWatchlist(activeId, sym);
      setLists((prev) => prev.map((l) => (l.id === activeId ? res.data : l)));
      setAddSymbolDraft('');
      setSymbolDropdown(false);
    } catch (err) {
      push('error', (err as Error).message);
    } finally {
      setAddingSymbol(false);
    }
  };

  const removeSymbol = async (symbol: string) => {
    if (!activeId) return;
    try {
      const res = await api.removeFromWatchlist(activeId, symbol);
      setLists((prev) => prev.map((l) => (l.id === activeId ? res.data : l)));
    } catch (err) {
      push('error', (err as Error).message);
    }
  };

  const toggleSort = (col: typeof sortBy) => {
    if (sortBy === col) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortBy(col); setSortDir('asc'); }
  };

  // Available symbols from live prices not already in list
  const suggestedSymbols = useMemo(() => {
    const q = addSymbolDraft.trim().toUpperCase();
    const inList = new Set(activeList?.symbols ?? []);
    return prices
      .filter((p) => !inList.has(p.symbol) && (!q || p.symbol.startsWith(q) || p.symbol.includes(q) || stockName(p).toUpperCase().includes(q)))
      .map((p) => p.symbol)
      .slice(0, 12);
  }, [addSymbolDraft, activeList, prices]);

  // ── render ─────────────────────────────────────────────────────────────────
  return (
    <div className="grid gap-5">

      {/* ── Header ── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-400/10">
            <BookMarked className="h-4 w-4 text-emerald-300" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-white">
              {activeList?.name ?? 'Watchlists'}
            </h2>
            <p className="text-xs text-white/40">
              {activeList
                ? `${activeList.symbols.length} symbol${activeList.symbols.length !== 1 ? 's' : ''} · ${stats.gainers} up · ${stats.losers} down`
                : `${lists.length} list${lists.length !== 1 ? 's' : ''}`}
            </p>
          </div>
        </div>

        {/* Right controls */}
        <div className="flex items-center gap-2">
          {/* Symbol select — pick a token from this watchlist */}
          {activeList && activeList.symbols.length > 0 && (
            <div className="relative">
              <Star className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/35" aria-hidden="true" />
              <Select
                value={selectedSymbol}
                onChange={(e) => setSelectedSymbol(e.target.value)}
                className="h-9 min-w-[160px] max-w-[200px] pl-8 text-sm"
              >
                <option value="">Select symbol…</option>
                {activeList.symbols.map((sym) => {
                  const p = prices.find((pr) => pr.symbol === sym);
                  return (
                    <option key={sym} value={sym}>
                      {stockName(p) ? `${sym} - ${stockName(p)}` : sym}{p ? ` - Rs. ${p.price.toLocaleString('en-NP')}` : ''}
                    </option>
                  );
                })}
              </Select>
            </div>
          )}
          {/* Watchlist select */}
          {lists.length > 0 && (
            <div className="relative">
              <List className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/35" aria-hidden="true" />
              <Select
                value={activeId}
                onChange={(e) => { setActiveId(e.target.value); setRenameId(null); }}
                className="h-9 min-w-[160px] max-w-[220px] pl-8 text-sm"
              >
                {lists.map((l) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </Select>
            </div>
          )}
          {/* Manage toggle */}
          <button
            type="button"
            onClick={() => setManageOpen((v) => !v)}
            title="Manage lists"
            className={cn(
              'flex h-9 w-9 items-center justify-center rounded-lg border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/35',
              manageOpen
                ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300'
                : 'border-white/10 bg-white/5 text-white/50 hover:border-white/20 hover:text-white/70',
            )}
          >
            <Settings2 className="h-4 w-4" />
          </button>
          <Button variant="secondary" size="sm" onClick={() => void load()}>
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </Button>
        </div>
      </div>

      {/* ── Manage panel (collapsible) ── */}
      <AnimatePresence initial={false}>
        {manageOpen && (
          <motion.div
            key="manage"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <Card className="p-4">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-white/40">Manage Lists</p>
              <div className="flex flex-col gap-2">
                {loading
                  ? Array.from({ length: 2 }).map((_, i) => (
                      <div key={i} className="h-9 animate-pulse rounded-lg bg-white/[0.04]" />
                    ))
                  : lists.map((list) => (
                      <div key={list.id} className="flex items-center gap-2 rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2">
                        {renameId === list.id ? (
                          <input
                            autoFocus
                            className="h-6 min-w-0 flex-1 rounded border border-violet-400/50 bg-transparent px-1 font-mono text-xs text-white outline-none"
                            value={renameDraft}
                            onChange={(e) => setRenameDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') void saveRename();
                              if (e.key === 'Escape') setRenameId(null);
                            }}
                            onBlur={() => void saveRename()}
                          />
                        ) : (
                          <>
                            <List className={cn('h-3.5 w-3.5 shrink-0', activeId === list.id ? 'text-emerald-300' : 'text-white/30')} />
                            <span
                              className={cn('min-w-0 flex-1 truncate text-sm cursor-pointer', activeId === list.id ? 'font-semibold text-white' : 'text-white/55 hover:text-white')}
                              onClick={() => { setActiveId(list.id); setManageOpen(false); }}
                            >
                              {list.name}
                            </span>
                            <span className="font-mono text-[10px] text-white/30">{list.symbols.length}</span>
                          </>
                        )}
                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            type="button"
                            onClick={() => { setRenameId(list.id); setRenameDraft(list.name); }}
                            className="rounded p-1 text-white/30 hover:text-white/70"
                            title="Rename"
                          >
                            <Edit2 className="h-3 w-3" />
                          </button>
                          {list.id !== 'default' && (
                            <button
                              type="button"
                              onClick={() => void deleteList(list.id)}
                              className="rounded p-1 text-red-400/40 hover:text-red-300"
                              title="Delete"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}

                {/* New list */}
                <div className="flex gap-2 pt-1">
                  <input
                    type="text"
                    placeholder="New list name…"
                    maxLength={60}
                    value={newListName}
                    onChange={(e) => setNewListName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') void createList(); }}
                    className="h-9 min-w-0 flex-1 rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-white placeholder:text-white/30 focus:border-white/30 focus:outline-none focus:ring-2 focus:ring-white/10"
                  />
                  <button
                    type="button"
                    onClick={() => void createList()}
                    disabled={!newListName.trim() || creatingList}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-white/50 transition-colors hover:border-emerald-400/40 hover:bg-emerald-400/10 hover:text-emerald-300 disabled:opacity-40"
                  >
                    {creatingList ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      {activeList ? (
        <>
          {/* ── Symbol detail card ── */}
          <AnimatePresence mode="wait">
            {selectedSymbol && (
              <motion.div
                key={selectedSymbol}
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.18 }}
              >
                <Card className="p-0 overflow-hidden">
                  <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
                    <div className="flex items-center gap-3">
                      <a
                        href={`https://www.nepsealpha.com/trading/chart?symbol=${encodeURIComponent(selectedSymbol)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1.5 font-mono text-base font-bold text-white hover:text-sky-300"
                      >
                        {selectedSymbol}
                        <ExternalLink className="h-3.5 w-3.5 opacity-50" />
                      </a>
                      {selectedPrice && (
                        <span className={cn(
                          'rounded-full px-2 py-0.5 text-[10px] font-semibold',
                          selectedPrice.source === 'LIVE'
                            ? 'bg-emerald-400/10 text-emerald-300'
                            : 'bg-amber-400/10 text-amber-300',
                        )}>
                          {selectedPrice.source}
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedSymbol('')}
                      className="rounded-lg p-1.5 text-white/30 hover:bg-white/5 hover:text-white/70"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  {selectedPrice ? (
                    <div className="grid grid-cols-2 gap-px bg-white/[0.04] sm:grid-cols-4 xl:grid-cols-8">
                      <DetailCell label="Price" value={`Rs. ${selectedPrice.price.toLocaleString('en-NP', { minimumFractionDigits: 2 })}`} highlight />
                      <DetailCell
                        label="Change"
                        value={`${selectedPrice.change >= 0 ? '+' : ''}${selectedPrice.change.toLocaleString('en-NP', { minimumFractionDigits: 2 })}`}
                        tone={selectedPrice.change > 0 ? 'up' : selectedPrice.change < 0 ? 'down' : 'flat'}
                      />
                      <DetailCell
                        label="Change %"
                        value={`${selectedPrice.changePct >= 0 ? '+' : ''}${selectedPrice.changePct.toFixed(2)}%`}
                        tone={selectedPrice.change > 0 ? 'up' : selectedPrice.change < 0 ? 'down' : 'flat'}
                      />
                      <DetailCell label="Prev Close" value={`Rs. ${selectedPrice.prevClose.toLocaleString('en-NP', { minimumFractionDigits: 2 })}`} />
                      <DetailCell label="High" value={`Rs. ${selectedPrice.high.toLocaleString('en-NP', { minimumFractionDigits: 2 })}`} tone="up" />
                      <DetailCell label="Low" value={`Rs. ${selectedPrice.low.toLocaleString('en-NP', { minimumFractionDigits: 2 })}`} tone="down" />
                      <DetailCell label="Volume" value={new Intl.NumberFormat('en-NP', { notation: 'compact' }).format(selectedPrice.volume)} />
                      <DetailCell label="Turnover" value={`Rs. ${new Intl.NumberFormat('en-NP', { notation: 'compact', maximumFractionDigits: 1 }).format(selectedPrice.turnover)}`} />
                    </div>
                  ) : (
                    <div className="px-4 py-6 text-center text-sm text-white/30">No live price data for {selectedSymbol}</div>
                  )}
                </Card>
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── Stats strip ── */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-6">
            <StatChip icon={TrendingUp} label="Gainers" value={stats.gainers} tone="up" />
            <StatChip icon={TrendingDown} label="Losers" value={stats.losers} tone="down" />
            <StatChip icon={Bell} label="Alerts" value={stats.activeAlerts} tone="neutral" />
            <StatChip icon={Flame} label="Turnover" value={`Rs. ${compact(stats.totalTurnover)}`} tone="neutral" />
            {stats.best && (
              <div className="col-span-2 flex items-center gap-3 rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2">
                <div className="flex flex-1 items-center justify-between gap-2">
                  <LeaderRow label="Best" item={stats.best} tone="up" />
                </div>
                {stats.worst && stats.worst.symbol !== stats.best.symbol && (
                  <div className="flex flex-1 items-center justify-between gap-2 border-l border-white/[0.07] pl-3">
                    <LeaderRow label="Worst" item={stats.worst} tone="down" />
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Toolbar ── */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/30" />
              <Input
                placeholder={`Filter ${activeList.name} by symbol or name...`}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-8 text-sm"
              />
            </div>
            {/* Add symbol */}
            <div className="relative">
              <div className="flex gap-1">
                <input
                  ref={addInputRef}
                  type="text"
                  placeholder="Add symbol…"
                  maxLength={12}
                  value={addSymbolDraft}
                  onChange={(e) => { setAddSymbolDraft(e.target.value.toUpperCase()); setSymbolDropdown(true); }}
                  onFocus={() => setSymbolDropdown(true)}
                  onBlur={() => setTimeout(() => setSymbolDropdown(false), 160)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void addSymbol(); if (e.key === 'Escape') { setAddSymbolDraft(''); setSymbolDropdown(false); } }}
                  className="h-10 w-36 rounded-lg border border-white/10 bg-white/5 px-3 font-mono text-sm text-white placeholder:font-sans placeholder:text-white/30 focus:border-emerald-400/50 focus:outline-none focus:ring-2 focus:ring-emerald-400/20"
                />
                <button
                  type="button"
                  onClick={() => void addSymbol()}
                  disabled={!addSymbolDraft.trim() || addingSymbol}
                  className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-white/50 transition-colors hover:border-emerald-400/40 hover:bg-emerald-400/10 hover:text-emerald-300 disabled:opacity-40"
                >
                  {addingSymbol ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                </button>
              </div>
              <AnimatePresence>
                {symbolDropdown && suggestedSymbols.length > 0 && (
                  <motion.ul
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.1 }}
                    className="absolute right-0 top-full z-50 mt-1 max-h-52 w-52 overflow-y-auto rounded-xl border border-white/10 bg-zinc-900 shadow-2xl"
                  >
                  {suggestedSymbols.map((sym) => {
                    const p = prices.find((pr) => pr.symbol === sym);
                    return (
                        <li
                          key={sym}
                          onMouseDown={() => { setAddSymbolDraft(sym); void (async () => { setAddingSymbol(true); try { const res = await api.addToWatchlist(activeId, sym); setLists((prev) => prev.map((l) => l.id === activeId ? res.data : l)); setAddSymbolDraft(''); } catch (err) { push('error', (err as Error).message); } finally { setAddingSymbol(false); setSymbolDropdown(false); } })(); }}
                          className="flex cursor-pointer items-center justify-between px-3 py-2 text-sm hover:bg-white/[0.06]"
                        >
                          <span className="min-w-0">
                            <span className="block font-mono font-semibold text-white">{sym}</span>
                            {stockName(p) && <span className="block max-w-32 truncate text-xs text-white/40">{stockName(p)}</span>}
                          </span>
                          {p && (
                            <span className={cn('font-mono text-xs', p.change >= 0 ? 'text-emerald-300' : 'text-red-300')}>
                              {p.change >= 0 ? '+' : ''}{p.changePct.toFixed(2)}%
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </motion.ul>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* ── Symbol table ── */}
          <Card className="overflow-hidden p-0">
            {/* Column headers */}
            <div className="grid grid-cols-[auto_1fr_repeat(4,minmax(80px,auto))_40px] items-center gap-x-3 border-b border-white/[0.06] px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-white/35">
              <span className="w-6" />
              <SortHeader label="Symbol" col="name" active={sortBy} dir={sortDir} onToggle={toggleSort} />
              <SortHeader label="Price" col="price" active={sortBy} dir={sortDir} onToggle={toggleSort} className="text-right" />
              <SortHeader label="Change" col="change" active={sortBy} dir={sortDir} onToggle={toggleSort} className="text-right" />
              <span className="text-right">Vol</span>
              <span className="text-right">Alerts</span>
              <span />
            </div>

            {/* Rows */}
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} />)
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
                <Star className="h-6 w-6 text-white/15" />
                <p className="text-sm text-white/40">
                  {query ? 'No symbols match your filter.' : 'This list is empty. Add symbols using the field above.'}
                </p>
              </div>
            ) : (
              <AnimatePresence initial={false}>
                {filtered.map(({ symbol, price, alerts: rowAlerts }) => (
                  <SymbolRow
                    key={symbol}
                    symbol={symbol}
                    price={price}
                    alerts={rowAlerts}
                    onRemove={() => void removeSymbol(symbol)}
                  />
                ))}
              </AnimatePresence>
            )}

            {/* Footer */}
            {filtered.length > 0 && (
              <div className="border-t border-white/[0.05] px-4 py-3 text-xs text-white/30">
                {filtered.length} symbol{filtered.length !== 1 ? 's' : ''} · {stats.gainers} up · {stats.losers} down · {stats.flat} flat
              </div>
            )}
          </Card>
        </>
      ) : (
        <div className="flex items-center justify-center rounded-2xl border border-dashed border-white/10 py-20 text-white/40">
          Select or create a watchlist to get started.
        </div>
      )}
    </div>
  );
}

// ── SymbolRow ─────────────────────────────────────────────────────────────────
function SymbolRow({
  symbol,
  price,
  alerts,
  onRemove,
}: {
  symbol: string;
  price: PriceSummary | null;
  alerts: StockAlert[];
  onRemove: () => void;
}) {
  const isUp = (price?.change ?? 0) >= 0;
  const activeAlerts = alerts.filter((a) => a.status === 'ACTIVE').length;
  const triggeredAlerts = alerts.filter((a) => a.status === 'TRIGGERED').length;

  return (
    <motion.div
      layout
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.15 }}
      className="group grid grid-cols-[auto_1fr_repeat(4,minmax(80px,auto))_40px] items-center gap-x-3 border-b border-white/[0.04] px-4 py-3 transition-colors hover:bg-white/[0.03] last:border-b-0"
    >
      {/* Drag handle placeholder */}
      <GripVertical className="h-4 w-4 text-white/[0.08] group-hover:text-white/20" />

      {/* Symbol */}
      <div className="flex min-w-0 items-center gap-2">
        <a
          href={`https://www.nepsealpha.com/trading/chart?symbol=${encodeURIComponent(symbol)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 font-mono text-sm font-bold text-white hover:text-sky-300"
        >
          <span className="min-w-0">
            <span className="block">{symbol}</span>
            {stockName(price) && <span className="block max-w-40 truncate font-sans text-[11px] font-normal text-white/35">{stockName(price)}</span>}
          </span>
          <ExternalLink className="h-3 w-3 opacity-0 group-hover:opacity-60" />
        </a>
        {!price && (
          <span className="rounded-full bg-white/5 px-1.5 py-0.5 text-[10px] text-white/30">no data</span>
        )}
      </div>

      {/* Price */}
      <div className="text-right font-mono text-sm font-semibold tabular-nums text-white">
        {price ? `Rs. ${price.price.toLocaleString('en-NP')}` : '—'}
      </div>

      {/* Change */}
      <div className={cn('flex items-center justify-end gap-1 font-mono text-xs tabular-nums', price ? (isUp ? 'text-emerald-300' : 'text-red-300') : 'text-white/30')}>
        {price ? (
          <>
            {isUp ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
            {isUp ? '+' : ''}{price.changePct.toFixed(2)}%
          </>
        ) : '—'}
      </div>

      {/* Volume */}
      <div className="text-right font-mono text-xs tabular-nums text-white/45">
        {price?.volume ? compact(price.volume) : '—'}
      </div>

      {/* Alerts */}
      <div className="flex items-center justify-end gap-1">
        {activeAlerts > 0 && (
          <span className="rounded-full bg-sky-400/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-sky-300">
            {activeAlerts}
          </span>
        )}
        {triggeredAlerts > 0 && (
          <span className="rounded-full bg-emerald-400/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-emerald-300">
            ✓{triggeredAlerts}
          </span>
        )}
        {activeAlerts === 0 && triggeredAlerts === 0 && (
          <span className="text-[10px] text-white/20">—</span>
        )}
      </div>

      {/* Remove */}
      <button
        type="button"
        onClick={onRemove}
        title="Remove from list"
        className="flex h-7 w-7 items-center justify-center rounded-lg text-white/20 opacity-0 transition-all hover:bg-red-400/10 hover:text-red-300 group-hover:opacity-100"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </motion.div>
  );
}

// ── sub-components ────────────────────────────────────────────────────────────
function SortHeader({
  label, col, active, dir, onToggle, className,
}: {
  label: string;
  col: 'name' | 'price' | 'change';
  active: string;
  dir: 'asc' | 'desc';
  onToggle: (col: 'name' | 'price' | 'change') => void;
  className?: string;
}) {
  const isActive = active === col;
  return (
    <button
      type="button"
      onClick={() => onToggle(col)}
      className={cn('flex items-center gap-1 transition-colors hover:text-white/70', isActive ? 'text-white/70' : '', className)}
    >
      {label}
      {isActive ? (dir === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />) : null}
    </button>
  );
}

function StatChip({
  icon: Icon, label, value, tone,
}: {
  icon: React.ElementType;
  label: string;
  value: number | string;
  tone: 'up' | 'down' | 'neutral';
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2">
      <div className="flex items-center gap-2">
        <Icon className="h-3.5 w-3.5 text-white/30" />
        <span className="text-xs text-white/45">{label}</span>
      </div>
      <span className={cn('font-mono text-xs font-semibold',
        tone === 'up' ? 'text-emerald-300' : tone === 'down' ? 'text-red-300' : 'text-white/70'
      )}>
        {value}
      </span>
    </div>
  );
}

function LeaderRow({
  label, item, tone,
}: {
  label: string;
  item: { symbol: string; price: PriceSummary | null };
  tone: 'up' | 'down';
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[10px] uppercase tracking-wider text-white/30">{label}</span>
      <div className="flex items-center gap-2">
        <span>
          <span className="block font-mono text-xs font-bold text-white">{item.symbol}</span>
          {stockName(item.price) && <span className="block max-w-28 truncate text-[10px] text-white/35">{stockName(item.price)}</span>}
        </span>
        <span className={cn('font-mono text-xs', tone === 'up' ? 'text-emerald-300' : 'text-red-300')}>
          {item.price ? `${item.price.changePct >= 0 ? '+' : ''}${item.price.changePct.toFixed(2)}%` : '—'}
        </span>
      </div>
    </div>
  );
}

function DetailCell({
  label,
  value,
  tone,
  highlight,
}: {
  label: string;
  value: string;
  tone?: 'up' | 'down' | 'flat';
  highlight?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5 bg-zinc-950/60 px-4 py-3">
      <span className="text-[10px] uppercase tracking-wider text-white/35">{label}</span>
      <span className={cn(
        'font-mono text-sm font-semibold tabular-nums',
        highlight ? 'text-white' :
        tone === 'up' ? 'text-emerald-300' :
        tone === 'down' ? 'text-red-300' :
        'text-white/70',
      )}>
        {value}
      </span>
    </div>
  );
}

function SkeletonRow() {  return (
    <div className="grid animate-pulse grid-cols-[auto_1fr_repeat(4,minmax(80px,auto))_40px] items-center gap-x-3 border-b border-white/[0.04] px-4 py-3">
      <div className="h-4 w-4 rounded bg-white/[0.04]" />
      <div className="h-4 w-20 rounded bg-white/[0.06]" />
      <div className="ml-auto h-4 w-16 rounded bg-white/[0.04]" />
      <div className="ml-auto h-4 w-14 rounded bg-white/[0.04]" />
      <div className="ml-auto h-4 w-12 rounded bg-white/[0.04]" />
      <div className="ml-auto h-4 w-8 rounded bg-white/[0.04]" />
      <div className="h-7 w-7 rounded bg-white/[0.03]" />
    </div>
  );
}
