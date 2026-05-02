'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Columns3,
  Database,
  Download,
  Eye,
  FileJson,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import {
  api,
  type DbColumn,
  type DbTableSchema,
  type DbTableSummary,
} from '@/lib/api';
import { Card } from './ui/card';
import { Button } from './ui/button';
import { Input, Select } from './ui/input';
import { useToast } from './ui/toast';
import { cn } from '@/lib/utils';

const PAGE_SIZES = [10, 25, 50, 100];
type SortDir = 'asc' | 'desc';
type RowMap = Record<string, unknown>;

export function DatabasePanel() {
  const toast = useToast();
  const [tables, setTables] = useState<DbTableSummary[]>([]);
  const [stats, setStats] = useState<Record<string, number>>({});
  const [activeName, setActiveName] = useState<string | null>(null);
  const [schema, setSchema] = useState<DbTableSchema | null>(null);
  const [rows, setRows] = useState<RowMap[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [hiddenCols, setHiddenCols] = useState<Set<string>>(new Set());
  const [showColPicker, setShowColPicker] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loadingTables, setLoadingTables] = useState(true);
  const [loadingRows, setLoadingRows] = useState(false);
  const [editing, setEditing] = useState<{ mode: 'create' | 'edit'; row: RowMap | null } | null>(null);
  const [viewing, setViewing] = useState<RowMap | null>(null);
  const [exporting, setExporting] = useState(false);

  const refreshStats = () => {
    api
      .getDbStats()
      .then((res) => setStats(res.data))
      .catch(() => {});
  };

  useEffect(() => {
    Promise.all([api.listDbTables(), api.getDbStats()])
      .then(([list, s]) => {
        setTables(list.data);
        setStats(s.data);
        if (list.data[0]) setActiveName(list.data[0].name);
      })
      .catch((err: Error) => toast.push('error', err.message || 'Failed to load tables'))
      .finally(() => setLoadingTables(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!activeName) return;
    setLoadingRows(true);
    setSchema(null);
    setSelected(new Set());
    setHiddenCols(new Set());
    setSortField(null);
    Promise.all([
      api.getDbTableSchema(activeName),
      api.listDbRows(activeName, { page, limit: pageSize, search }),
    ])
      .then(([s, r]) => {
        setSchema(s.data);
        setRows(r.data);
        setTotal(r.meta.total);
      })
      .catch((err: Error) => toast.push('error', err.message || 'Failed to load rows'))
      .finally(() => setLoadingRows(false));
  }, [activeName]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!activeName || !schema) return;
    setLoadingRows(true);
    setSelected(new Set());
    api
      .listDbRows(activeName, {
        page,
        limit: pageSize,
        search,
        sortField: sortField ?? undefined,
        sortDir: sortField ? sortDir : undefined,
      })
      .then((r) => {
        setRows(r.data);
        setTotal(r.meta.total);
      })
      .catch((err: Error) => toast.push('error', err.message || 'Failed to refresh'))
      .finally(() => setLoadingRows(false));
  }, [page, pageSize, search, sortField, sortDir]); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = () => {
    if (!activeName || !schema) return;
    setLoadingRows(true);
    api
      .listDbRows(activeName, {
        page,
        limit: pageSize,
        search,
        sortField: sortField ?? undefined,
        sortDir: sortField ? sortDir : undefined,
      })
      .then((r) => {
        setRows(r.data);
        setTotal(r.meta.total);
      })
      .catch((err: Error) => toast.push('error', err.message || 'Failed to refresh'))
      .finally(() => {
        setLoadingRows(false);
        refreshStats();
      });
  };

  const handleDelete = async (row: RowMap) => {
    if (!schema) return;
    const id = String(row[schema.idField] ?? '');
    if (!id) return;
    if (!confirm(`Delete row "${id}" from ${schema.label}? This cannot be undone.`)) return;
    try {
      await api.deleteDbRow(schema.name, id);
      toast.push('success', 'Row deleted');
      refresh();
    } catch (err) {
      toast.push('error', (err as Error).message || 'Failed to delete row');
    }
  };

  const handleBulkDelete = async () => {
    if (!schema || selected.size === 0) return;
    if (!confirm(`Delete ${selected.size} selected row${selected.size === 1 ? '' : 's'}? This cannot be undone.`)) return;
    try {
      const res = await api.bulkDeleteDbRows(schema.name, Array.from(selected));
      toast.push('success', `Deleted ${res.data.deleted} row${res.data.deleted === 1 ? '' : 's'}`);
      setSelected(new Set());
      refresh();
    } catch (err) {
      toast.push('error', (err as Error).message || 'Bulk delete failed');
    }
  };

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
    setPage(1);
  };

  const handleExport = async (format: 'json' | 'csv') => {
    if (!schema) return;
    setExporting(true);
    try {
      const res = await api.exportDbRows(schema.name, {
        search,
        sortField: sortField ?? undefined,
        sortDir: sortField ? sortDir : undefined,
      });
      const fileBase = `${schema.name}-${new Date().toISOString().slice(0, 10)}`;
      if (format === 'json') {
        downloadFile(`${fileBase}.json`, JSON.stringify(res.data, null, 2), 'application/json');
      } else {
        downloadFile(`${fileBase}.csv`, toCsv(res.data, schema.columns), 'text/csv');
      }
      toast.push('success', `Exported ${res.data.length} row${res.data.length === 1 ? '' : 's'}`);
    } catch (err) {
      toast.push('error', (err as Error).message || 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  const toggleColumn = (name: string) => {
    setHiddenCols((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const activeTable = useMemo(() => tables.find((t) => t.name === activeName) ?? null, [tables, activeName]);
  const visibleColumns = useMemo(
    () => (schema ? schema.columns.filter((c) => !hiddenCols.has(c.name)) : []),
    [schema, hiddenCols],
  );
  const allSelected = rows.length > 0 && rows.every((r) => schema && selected.has(String(r[schema.idField] ?? '')));

  return (
    <div className="grid gap-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-cyan-400/10">
            <Database className="h-4 w-4 text-cyan-300" aria-hidden="true" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white">Database Browser</h3>
            <p className="text-xs text-white/40">
              Inspect, sort, edit, export, and bulk-manage records directly from PostgreSQL.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {schema && (
            <>
              <div className="relative">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setShowColPicker((v) => !v)}
                  disabled={!schema}
                >
                  <Columns3 className="h-3.5 w-3.5" />
                  Columns
                </Button>
                {showColPicker && (
                  <div className="absolute right-0 top-full z-20 mt-1 w-56 rounded-lg border border-white/10 bg-zinc-950 p-2 shadow-xl">
                    {schema.columns.map((c) => (
                      <label
                        key={c.name}
                        className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs text-white/75 hover:bg-white/[0.05]"
                      >
                        <input
                          type="checkbox"
                          checked={!hiddenCols.has(c.name)}
                          onChange={() => toggleColumn(c.name)}
                          className="h-3.5 w-3.5 accent-cyan-400"
                        />
                        <span className="truncate font-mono">{c.name}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
              <Button variant="secondary" size="sm" onClick={() => handleExport('csv')} loading={exporting}>
                <Download className="h-3.5 w-3.5" />
                CSV
              </Button>
              <Button variant="secondary" size="sm" onClick={() => handleExport('json')} loading={exporting}>
                <FileJson className="h-3.5 w-3.5" />
                JSON
              </Button>
            </>
          )}
          <Button variant="secondary" size="sm" onClick={refresh} disabled={!schema || loadingRows}>
            <RefreshCw className={cn('h-3.5 w-3.5', loadingRows && 'animate-spin')} />
            Refresh
          </Button>
          {schema && !activeTable?.noCreate && (
            <Button size="sm" onClick={() => setEditing({ mode: 'create', row: null })}>
              <Plus className="h-3.5 w-3.5" />
              New Row
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="min-w-0">
          <Card className="overflow-hidden p-0">
            <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
              <div className="text-xs font-semibold uppercase tracking-wider text-white/40">Tables</div>
              <button
                type="button"
                onClick={refreshStats}
                className="text-white/35 transition-colors hover:text-white/70"
                aria-label="Refresh row counts"
              >
                <RefreshCw className="h-3 w-3" />
              </button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto">
              {loadingTables ? (
                <div className="flex items-center justify-center px-4 py-8 text-xs text-white/40">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Loading…
                </div>
              ) : tables.length === 0 ? (
                <div className="px-4 py-8 text-center text-xs text-white/40">No tables exposed.</div>
              ) : (
                <ul className="divide-y divide-white/[0.04]">
                  {tables.map((t) => {
                    const active = activeName === t.name;
                    const count = stats[t.name];
                    return (
                      <li key={t.name}>
                        <button
                          type="button"
                          onClick={() => {
                            setActiveName(t.name);
                            setPage(1);
                            setSearch('');
                          }}
                          className={cn(
                            'flex w-full items-start gap-2 px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/35',
                            active ? 'bg-cyan-400/10 text-white' : 'text-white/65 hover:bg-white/[0.03] hover:text-white',
                          )}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <div className="truncate text-sm font-semibold">{t.label}</div>
                              {count !== undefined && (
                                <span className="shrink-0 rounded-full bg-white/[0.06] px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-white/55">
                                  {count}
                                </span>
                              )}
                            </div>
                            <div className="mt-0.5 truncate font-mono text-[11px] text-white/40">{t.prismaModel}</div>
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </Card>
        </aside>

        <section className="min-w-0">
          {activeTable && (
            <div className="mb-4 rounded-lg border border-white/[0.06] bg-white/[0.025] px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-white">{activeTable.label}</div>
                  <div className="mt-0.5 text-xs text-white/45">{activeTable.description}</div>
                </div>
                <div className="shrink-0 font-mono text-[11px] text-white/40">
                  {stats[activeTable.name] ?? '—'} rows
                </div>
              </div>
            </div>
          )}

          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <label className="relative block w-full sm:max-w-xs">
              <span className="sr-only">Search rows</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
              <Input
                type="search"
                placeholder={
                  activeTable?.searchableFields.length
                    ? `Search ${activeTable.searchableFields.join(', ')}…`
                    : 'Search…'
                }
                value={search}
                onChange={(e) => {
                  setPage(1);
                  setSearch(e.target.value);
                }}
                className="pl-9"
              />
            </label>
            <div className="flex items-center gap-2 text-xs text-white/45">
              <Select
                aria-label="Page size"
                value={String(pageSize)}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(1);
                }}
                className="h-8 w-20 px-2 text-xs"
              >
                {PAGE_SIZES.map((s) => (
                  <option key={s} value={s} className="bg-zinc-900">
                    {s}/pg
                  </option>
                ))}
              </Select>
              <span className="tabular-nums">
                {total === 0 ? '0' : (page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}
              </span>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1 || loadingRows}
              >
                Prev
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages || loadingRows}
              >
                Next
              </Button>
            </div>
          </div>

          {selected.size > 0 && schema && (
            <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-cyan-400/30 bg-cyan-400/[0.05] px-3 py-2">
              <div className="text-xs text-cyan-200">
                {selected.size} row{selected.size === 1 ? '' : 's'} selected
              </div>
              <div className="flex items-center gap-2">
                <Button variant="secondary" size="sm" onClick={() => setSelected(new Set())}>
                  Clear
                </Button>
                {!activeTable?.noDelete && (
                  <Button variant="danger" size="sm" onClick={handleBulkDelete}>
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete selected
                  </Button>
                )}
              </div>
            </div>
          )}

          <Card className="overflow-hidden p-0">
            {loadingRows ? (
              <div className="flex items-center justify-center px-6 py-16 text-sm text-white/40">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Loading rows…
              </div>
            ) : !schema ? (
              <div className="px-6 py-12 text-center text-sm text-white/40">Select a table to view rows.</div>
            ) : rows.length === 0 ? (
              <div className="px-6 py-12 text-center text-sm text-white/40">
                No rows found{search ? ` for "${search}"` : ''}.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-max border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-white/[0.07] bg-black/20">
                      <th className="w-10 px-3 py-3">
                        <input
                          type="checkbox"
                          checked={allSelected}
                          onChange={(e) => {
                            if (!schema) return;
                            if (e.target.checked) {
                              setSelected(new Set(rows.map((r) => String(r[schema.idField] ?? ''))));
                            } else {
                              setSelected(new Set());
                            }
                          }}
                          className="h-3.5 w-3.5 accent-cyan-400"
                        />
                      </th>
                      {visibleColumns.map((c) => {
                        const isSorted = sortField === c.name;
                        return (
                          <th
                            key={c.name}
                            className="whitespace-nowrap px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-white/45"
                          >
                            <button
                              type="button"
                              onClick={() => handleSort(c.name)}
                              className="inline-flex items-center gap-1 transition-colors hover:text-white/80"
                            >
                              {c.name}
                              {c.isId && <span className="text-cyan-300">id</span>}
                              {isSorted ? (
                                sortDir === 'asc' ? (
                                  <ArrowUp className="h-3 w-3 text-cyan-300" />
                                ) : (
                                  <ArrowDown className="h-3 w-3 text-cyan-300" />
                                )
                              ) : (
                                <ArrowUpDown className="h-3 w-3 text-white/25" />
                              )}
                            </button>
                          </th>
                        );
                      })}
                      <th className="sticky right-0 bg-black/40 px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-white/45">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, idx) => {
                      const id = String(row[schema.idField] ?? '');
                      const isSelected = selected.has(id);
                      return (
                        <tr
                          key={`${schema.idField}:${id || idx}`}
                          className={cn(
                            'border-b border-white/[0.04] transition-colors',
                            isSelected ? 'bg-cyan-400/[0.05]' : 'hover:bg-white/[0.02]',
                          )}
                        >
                          <td className="w-10 px-3 py-3">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={(e) => {
                                setSelected((prev) => {
                                  const next = new Set(prev);
                                  if (e.target.checked) next.add(id);
                                  else next.delete(id);
                                  return next;
                                });
                              }}
                              className="h-3.5 w-3.5 accent-cyan-400"
                            />
                          </td>
                          {visibleColumns.map((c) => (
                            <td key={c.name} className="max-w-xs px-4 py-3 align-top text-white/80">
                              <CellValue value={row[c.name]} type={c.type} />
                            </td>
                          ))}
                          <td className="sticky right-0 bg-zinc-950/85 px-4 py-3 backdrop-blur">
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => setViewing(row)}
                                className="rounded-md p-1.5 text-white/55 transition-colors hover:bg-white/[0.06] hover:text-white"
                                aria-label="View row"
                              >
                                <Eye className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditing({ mode: 'edit', row })}
                                className="rounded-md p-1.5 text-white/55 transition-colors hover:bg-white/[0.06] hover:text-white"
                                aria-label="Edit row"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                              {!activeTable?.noDelete && (
                                <button
                                  type="button"
                                  onClick={() => handleDelete(row)}
                                  className="rounded-md p-1.5 text-red-300/70 transition-colors hover:bg-red-400/10 hover:text-red-200"
                                  aria-label="Delete row"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </section>
      </div>

      {editing && schema && (
        <RowEditor
          schema={schema}
          mode={editing.mode}
          row={editing.row}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            refresh();
          }}
        />
      )}

      {viewing && schema && <RowDetail schema={schema} row={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}

function CellValue({ value, type }: { value: unknown; type: DbColumn['type'] }) {
  if (value === null || value === undefined) return <span className="text-white/25">null</span>;
  if (type === 'boolean') {
    return (
      <span
        className={cn(
          'rounded-full px-2 py-0.5 text-[10px] font-semibold',
          value ? 'bg-emerald-400/10 text-emerald-300' : 'bg-white/5 text-white/45',
        )}
      >
        {value ? 'true' : 'false'}
      </span>
    );
  }
  if (type === 'datetime') {
    const d = new Date(String(value));
    return <span className="font-mono text-xs tabular-nums text-white/65">{Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString()}</span>;
  }
  if (type === 'json') {
    return <span className="line-clamp-2 font-mono text-xs text-white/55">{JSON.stringify(value)}</span>;
  }
  if (type === 'string[]') {
    if (!Array.isArray(value)) return <span className="text-white/45">{String(value)}</span>;
    return (
      <div className="flex flex-wrap gap-1">
        {value.slice(0, 6).map((v, i) => (
          <span key={i} className="rounded bg-white/[0.05] px-1.5 py-0.5 font-mono text-[11px] text-white/70">
            {String(v)}
          </span>
        ))}
        {value.length > 6 && <span className="text-[11px] text-white/40">+{value.length - 6}</span>}
      </div>
    );
  }
  if (type === 'number') {
    return <span className="font-mono tabular-nums text-white/85">{String(value)}</span>;
  }
  return <span className="line-clamp-2 break-words">{String(value)}</span>;
}

function RowDetail({
  schema,
  row,
  onClose,
}: {
  schema: DbTableSchema;
  row: RowMap;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-8 backdrop-blur-sm">
      <Card className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden p-0">
        <div className="flex items-center justify-between gap-4 border-b border-white/[0.07] px-5 py-4">
          <div>
            <div className="text-sm font-semibold text-white">{schema.label} — Row Detail</div>
            <div className="mt-0.5 font-mono text-xs text-white/45">
              {schema.idField}: {String(row[schema.idField] ?? '')}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-white/55 transition-colors hover:bg-white/[0.06] hover:text-white"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">
          <pre className="whitespace-pre-wrap break-words rounded-lg border border-white/[0.05] bg-black/40 p-4 font-mono text-xs text-white/75">
            {JSON.stringify(row, null, 2)}
          </pre>
        </div>
      </Card>
    </div>
  );
}

function RowEditor({
  schema,
  mode,
  row,
  onClose,
  onSaved,
}: {
  schema: DbTableSchema;
  mode: 'create' | 'edit';
  row: RowMap | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [draft, setDraft] = useState<Record<string, string | boolean>>(() => {
    const out: Record<string, string | boolean> = {};
    for (const c of schema.columns) {
      const v = row?.[c.name];
      if (c.type === 'boolean') out[c.name] = Boolean(v);
      else if (v === null || v === undefined) out[c.name] = '';
      else if (c.type === 'json' || c.type === 'string[]') out[c.name] = JSON.stringify(v);
      else if (c.type === 'datetime') out[c.name] = v ? new Date(String(v)).toISOString().slice(0, 16) : '';
      else out[c.name] = String(v);
    }
    return out;
  });
  const [saving, setSaving] = useState(false);

  const editableColumns = schema.columns.filter((c) => !(c.isReadonly && mode === 'edit') && !(c.isReadonly && mode === 'create'));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {};
      for (const c of editableColumns) {
        if (c.isId && mode === 'edit') continue;
        payload[c.name] = draft[c.name];
      }
      if (mode === 'create') {
        await api.createDbRow(schema.name, payload);
        toast.push('success', 'Row created');
      } else if (row) {
        const id = String(row[schema.idField] ?? '');
        await api.updateDbRow(schema.name, id, payload);
        toast.push('success', 'Row updated');
      }
      onSaved();
    } catch (err) {
      toast.push('error', (err as Error).message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-8 backdrop-blur-sm">
      <Card className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden p-0">
        <div className="flex items-center justify-between gap-4 border-b border-white/[0.07] px-5 py-4">
          <div>
            <div className="text-sm font-semibold text-white">
              {mode === 'create' ? `New ${schema.label} row` : `Edit ${schema.label}`}
            </div>
            <div className="mt-0.5 text-xs text-white/45">
              {mode === 'edit' && row ? `${schema.idField}: ${String(row[schema.idField] ?? '')}` : 'Fill in the fields below.'}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-white/55 transition-colors hover:bg-white/[0.06] hover:text-white"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 overflow-y-auto px-5 py-4">
            <div className="grid gap-4">
              {editableColumns.map((c) => (
                <FieldEditor
                  key={c.name}
                  column={c}
                  value={draft[c.name]}
                  disabled={mode === 'edit' && c.isId}
                  onChange={(v) => setDraft((d) => ({ ...d, [c.name]: v }))}
                />
              ))}
            </div>
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-white/[0.07] px-5 py-3">
            <Button type="button" variant="secondary" size="sm" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" size="sm" loading={saving}>
              {mode === 'create' ? 'Create' : 'Save'}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

function FieldEditor({
  column,
  value,
  disabled,
  onChange,
}: {
  column: DbColumn;
  value: string | boolean;
  disabled?: boolean;
  onChange: (v: string | boolean) => void;
}) {
  const label = (
    <div className="mb-1.5 flex items-center gap-2">
      <span className="text-xs font-semibold text-white">{column.name}</span>
      <span className="rounded-full bg-white/[0.05] px-1.5 py-0.5 font-mono text-[10px] text-white/45">{column.type}</span>
      {column.optional && <span className="text-[10px] uppercase tracking-wider text-white/35">optional</span>}
      {column.isReadonly && <span className="text-[10px] uppercase tracking-wider text-amber-300/70">readonly</span>}
    </div>
  );

  if (column.type === 'boolean') {
    return (
      <label className="flex items-center justify-between gap-3 rounded-lg border border-white/[0.06] px-3 py-2.5">
        <div>{label}</div>
        <input
          type="checkbox"
          checked={Boolean(value)}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          className="h-4 w-4 accent-cyan-400"
        />
      </label>
    );
  }

  if (column.enumValues?.length) {
    return (
      <div>
        {label}
        <Select value={String(value)} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
          <option value="" className="bg-zinc-900">
            —
          </option>
          {column.enumValues.map((v) => (
            <option key={v} value={v} className="bg-zinc-900">
              {v}
            </option>
          ))}
        </Select>
      </div>
    );
  }

  if (column.type === 'json' || column.type === 'string[]') {
    return (
      <div>
        {label}
        <textarea
          value={String(value)}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          placeholder={column.type === 'json' ? '{"key":"value"}' : 'AAPL, MSFT, GOOG'}
          className="h-24 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 font-mono text-xs text-white placeholder:text-white/30 focus:border-white/30 focus:bg-white/[0.07] focus:outline-none focus:ring-2 focus:ring-white/10 disabled:opacity-50"
        />
      </div>
    );
  }

  if (column.type === 'datetime') {
    return (
      <div>
        {label}
        <Input type="datetime-local" value={String(value)} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
      </div>
    );
  }

  return (
    <div>
      {label}
      <Input
        type={column.type === 'number' ? 'number' : 'text'}
        value={String(value)}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        placeholder={column.optional ? '(empty)' : ''}
      />
    </div>
  );
}

function downloadFile(name: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function toCsv(rows: RowMap[], columns: DbColumn[]): string {
  const headers = columns.map((c) => c.name);
  const escape = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => escape(row[h])).join(','));
  }
  return lines.join('\n');
}
