import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type ColumnType = 'string' | 'number' | 'boolean' | 'datetime' | 'json' | 'string[]';

export interface ColumnMeta {
  name: string;
  type: ColumnType;
  isId?: boolean;
  isReadonly?: boolean;
  optional?: boolean;
  enumValues?: string[];
}

export interface TableMeta {
  name: string;
  label: string;
  description: string;
  prismaModel: string;
  idField: string;
  defaultSort?: { field: string; dir: 'asc' | 'desc' };
  searchableFields: string[];
  columns: ColumnMeta[];
  ownerScoped?: boolean;
  /**
   * Field that identifies row ownership. Defaults to 'userId'. For tables
   * whose primary key is itself the user id (e.g. the User table), set this
   * to 'id' so the row is filtered by the caller's id.
   */
  ownerField?: string;
  /** Disallow create through the generic database controller. */
  noCreate?: boolean;
  /** Disallow delete through the generic database controller. */
  noDelete?: boolean;
}

const TABLES: TableMeta[] = [
  {
    name: 'user',
    label: 'My Profile',
    description: 'Your authenticated account record. Edit your display name or profile picture.',
    prismaModel: 'user',
    idField: 'id',
    ownerScoped: true,
    ownerField: 'id',
    noCreate: true,
    noDelete: true,
    searchableFields: ['email', 'name'],
    columns: [
      { name: 'id', type: 'string', isId: true, isReadonly: true },
      { name: 'email', type: 'string', isReadonly: true },
      { name: 'name', type: 'string' },
      { name: 'picture', type: 'string', optional: true },
      { name: 'googleSub', type: 'string', isReadonly: true },
      { name: 'createdAt', type: 'datetime', isReadonly: true },
      { name: 'updatedAt', type: 'datetime', isReadonly: true },
    ],
  },
  {
    name: 'alert',
    label: 'Alerts',
    description: 'Price alerts queued against stock symbols.',
    prismaModel: 'alert',
    idField: 'id',
    defaultSort: { field: 'createdAt', dir: 'desc' },
    searchableFields: ['symbol', 'status', 'condition', 'priority', 'note'],
    ownerScoped: true,
    columns: [
      { name: 'id', type: 'string', isId: true, isReadonly: true },
      { name: 'symbol', type: 'string' },
      { name: 'targetPrice', type: 'number' },
      { name: 'condition', type: 'string', enumValues: ['ABOVE', 'BELOW', 'EQUAL'] },
      { name: 'status', type: 'string', enumValues: ['ACTIVE', 'TRIGGERED', 'EXPIRED', 'CANCELLED'] },
      { name: 'priority', type: 'string', enumValues: ['HIGH', 'MEDIUM', 'LOW'] },
      { name: 'note', type: 'string', optional: true },
      { name: 'lastCheckedPrice', type: 'number', optional: true },
      { name: 'createdAt', type: 'datetime', isReadonly: true },
      { name: 'triggeredAt', type: 'datetime', optional: true },
    ],
  },
  {
    name: 'watchlist',
    label: 'Watchlists',
    description: 'Symbol collections grouped by user-defined lists.',
    prismaModel: 'watchlist',
    idField: 'id',
    defaultSort: { field: 'updatedAt', dir: 'desc' },
    searchableFields: ['name'],
    ownerScoped: true,
    columns: [
      { name: 'id', type: 'string', isId: true, isReadonly: true },
      { name: 'name', type: 'string' },
      { name: 'symbols', type: 'string[]' },
      { name: 'symbolAddedAt', type: 'json' },
      { name: 'createdAt', type: 'datetime', isReadonly: true },
      { name: 'updatedAt', type: 'datetime', isReadonly: true },
    ],
  },
  {
    name: 'log',
    label: 'Logs',
    description: 'Crawler and system events.',
    prismaModel: 'log',
    idField: 'id',
    defaultSort: { field: 'createdAt', dir: 'desc' },
    searchableFields: ['level', 'message'],
    columns: [
      { name: 'id', type: 'string', isId: true, isReadonly: true },
      { name: 'level', type: 'string', enumValues: ['INFO', 'WARN', 'ERROR', 'DEBUG'] },
      { name: 'message', type: 'string' },
      { name: 'createdAt', type: 'datetime', isReadonly: true },
    ],
  },
  {
    name: 'setting',
    label: 'Settings',
    description: 'Persisted system configuration key/value pairs.',
    prismaModel: 'setting',
    idField: 'key',
    searchableFields: ['key', 'value'],
    columns: [
      { name: 'key', type: 'string', isId: true },
      { name: 'value', type: 'string' },
    ],
  },
  {
    name: 'notificationChannel',
    label: 'Notification Channels',
    description: 'Outbound delivery integrations (Slack, WhatsApp, etc.).',
    prismaModel: 'notificationChannel',
    idField: 'id',
    defaultSort: { field: 'updatedAt', dir: 'desc' },
    searchableFields: ['name', 'type'],
    ownerScoped: true,
    columns: [
      { name: 'id', type: 'string', isId: true, isReadonly: true },
      { name: 'name', type: 'string' },
      { name: 'type', type: 'string' },
      { name: 'enabled', type: 'boolean' },
      { name: 'config', type: 'json' },
      { name: 'createdAt', type: 'datetime', isReadonly: true },
      { name: 'updatedAt', type: 'datetime', isReadonly: true },
    ],
  },
  {
    name: 'notificationTemplate',
    label: 'Notification Templates',
    description: 'Message bodies/subjects for each event.',
    prismaModel: 'notificationTemplate',
    idField: 'id',
    defaultSort: { field: 'updatedAt', dir: 'desc' },
    searchableFields: ['name', 'event'],
    ownerScoped: true,
    columns: [
      { name: 'id', type: 'string', isId: true, isReadonly: true },
      { name: 'name', type: 'string' },
      { name: 'event', type: 'string' },
      { name: 'channelId', type: 'string', optional: true },
      { name: 'subject', type: 'string', optional: true },
      { name: 'body', type: 'string' },
      { name: 'isDefault', type: 'boolean' },
      { name: 'createdAt', type: 'datetime', isReadonly: true },
      { name: 'updatedAt', type: 'datetime', isReadonly: true },
    ],
  },
  {
    name: 'notificationRule',
    label: 'Notification Rules',
    description: 'Bindings of events to channels with filters and cooldowns.',
    prismaModel: 'notificationRule',
    idField: 'id',
    defaultSort: { field: 'priority', dir: 'desc' },
    searchableFields: ['name', 'event'],
    ownerScoped: true,
    columns: [
      { name: 'id', type: 'string', isId: true, isReadonly: true },
      { name: 'name', type: 'string' },
      { name: 'event', type: 'string' },
      { name: 'enabled', type: 'boolean' },
      { name: 'priority', type: 'number' },
      { name: 'channelId', type: 'string' },
      { name: 'templateId', type: 'string', optional: true },
      { name: 'cooldownMin', type: 'number' },
      { name: 'filters', type: 'json' },
      { name: 'createdAt', type: 'datetime', isReadonly: true },
      { name: 'updatedAt', type: 'datetime', isReadonly: true },
    ],
  },
  {
    name: 'priceHistory',
    label: 'Price History',
    description: 'Historical price snapshots written by the crawler.',
    prismaModel: 'priceHistory',
    idField: 'id',
    defaultSort: { field: 'timestamp', dir: 'desc' },
    searchableFields: ['symbol', 'source'],
    columns: [
      { name: 'id', type: 'string', isId: true, isReadonly: true },
      { name: 'symbol', type: 'string' },
      { name: 'price', type: 'number' },
      { name: 'source', type: 'string' },
      { name: 'timestamp', type: 'datetime', isReadonly: true },
    ],
  },
];

@Injectable()
export class DatabaseService {
  constructor(private readonly prisma: PrismaService) {}

  listTables() {
    return TABLES.map(({ columns: _columns, ...rest }) => rest);
  }

  async stats(userId: string) {
    const out: Record<string, number> = {};
    await Promise.all(
      TABLES.map(async (t) => {
        try {
          out[t.name] = await this.model(t).count({ where: this.ownerWhere(t, userId) });
        } catch {
          out[t.name] = 0;
        }
      }),
    );
    return out;
  }

  private getTable(name: string): TableMeta {
    const table = TABLES.find((t) => t.name === name);
    if (!table) throw new NotFoundException(`Unknown table: ${name}`);
    return table;
  }

  getTableMeta(name: string): TableMeta {
    return this.getTable(name);
  }

  private model(table: TableMeta): {
    findMany: (args: unknown) => Promise<unknown[]>;
    findFirst: (args: unknown) => Promise<unknown | null>;
    count: (args?: unknown) => Promise<number>;
    create: (args: unknown) => Promise<unknown>;
    update: (args: unknown) => Promise<unknown>;
    delete: (args: unknown) => Promise<unknown>;
  } {
    const client = this.prisma as unknown as Record<string, unknown>;
    const m = client[table.prismaModel];
    if (!m) throw new NotFoundException(`Model not registered: ${table.prismaModel}`);
    return m as never;
  }

  async list(
    name: string,
    userId: string,
    opts: { page: number; limit: number; search?: string; sortField?: string; sortDir?: 'asc' | 'desc' },
  ) {
    const table = this.getTable(name);
    const limit = Math.min(Math.max(opts.limit, 1), 500);
    const page = Math.max(opts.page, 1);

    const searchWhere = opts.search
      ? {
          OR: table.searchableFields.map((f) => ({
            [f]: { contains: opts.search, mode: 'insensitive' as const },
          })),
        }
      : undefined;
    const ownerWhere = this.ownerWhere(table, userId);
    const where = ownerWhere && searchWhere ? { AND: [ownerWhere, searchWhere] } : ownerWhere ?? searchWhere;

    const sortField = opts.sortField && table.columns.some((c) => c.name === opts.sortField)
      ? opts.sortField
      : table.defaultSort?.field;
    const sortDir: 'asc' | 'desc' = opts.sortDir === 'asc' ? 'asc' : opts.sortDir === 'desc' ? 'desc' : table.defaultSort?.dir ?? 'desc';
    const orderBy = sortField ? { [sortField]: sortDir } : undefined;

    const [rows, total] = await Promise.all([
      this.model(table).findMany({
        where,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.model(table).count({ where }),
    ]);

    return { rows, total, page, limit, table };
  }

  private coerce(table: TableMeta, payload: Record<string, unknown>, isCreate: boolean) {
    const out: Record<string, unknown> = {};
    for (const col of table.columns) {
      if (!(col.name in payload)) continue;
      if (col.isReadonly) continue;
      const raw = payload[col.name];
      if (raw === null || raw === undefined || raw === '') {
        if (col.optional) {
          out[col.name] = null;
          continue;
        }
        if (!isCreate) continue;
        throw new BadRequestException(`Field ${col.name} is required`);
      }
      switch (col.type) {
        case 'string':
          out[col.name] = String(raw);
          break;
        case 'number': {
          const n = Number(raw);
          if (Number.isNaN(n)) throw new BadRequestException(`${col.name} must be a number`);
          out[col.name] = n;
          break;
        }
        case 'boolean':
          out[col.name] = Boolean(raw);
          break;
        case 'datetime':
          out[col.name] = new Date(String(raw));
          break;
        case 'json':
          if (typeof raw === 'string') {
            try {
              out[col.name] = JSON.parse(raw);
            } catch {
              throw new BadRequestException(`${col.name} must be valid JSON`);
            }
          } else {
            out[col.name] = raw;
          }
          break;
        case 'string[]':
          if (Array.isArray(raw)) out[col.name] = raw.map(String);
          else if (typeof raw === 'string')
            out[col.name] = raw
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean);
          else throw new BadRequestException(`${col.name} must be a string array`);
          break;
      }
    }
    return out;
  }

  async create(name: string, payload: Record<string, unknown>, userId: string) {
    const table = this.getTable(name);
    if (table.noCreate) {
      throw new BadRequestException(`Creating rows in ${table.label} is not allowed`);
    }
    const data = this.coerce(table, payload, true);
    if (table.ownerScoped && (table.ownerField ?? 'userId') === 'userId') {
      data.userId = userId;
    }
    return this.model(table).create({ data });
  }

  async update(name: string, id: string, payload: Record<string, unknown>, userId: string) {
    const table = this.getTable(name);
    await this.assertOwnsRow(table, id, userId);
    const data = this.coerce(table, payload, false);
    return this.model(table).update({ where: { [table.idField]: id }, data });
  }

  async remove(name: string, id: string, userId: string) {
    const table = this.getTable(name);
    if (table.noDelete) {
      throw new BadRequestException(`Deleting rows in ${table.label} is not allowed`);
    }
    await this.assertOwnsRow(table, id, userId);
    await this.model(table).delete({ where: { [table.idField]: id } });
    return { id };
  }

  async removeMany(name: string, ids: string[], userId: string) {
    const table = this.getTable(name);
    if (table.noDelete) {
      throw new BadRequestException(`Deleting rows in ${table.label} is not allowed`);
    }
    let deleted = 0;
    for (const id of ids) {
      try {
        await this.assertOwnsRow(table, id, userId);
        await this.model(table).delete({ where: { [table.idField]: id } });
        deleted += 1;
      } catch {
        // continue: row may have been removed already
      }
    }
    return { deleted };
  }

  async export(name: string, userId: string, opts: { search?: string; sortField?: string; sortDir?: 'asc' | 'desc' }) {
    const table = this.getTable(name);
    const searchWhere = opts.search
      ? {
          OR: table.searchableFields.map((f) => ({
            [f]: { contains: opts.search, mode: 'insensitive' as const },
          })),
        }
      : undefined;
    const ownerWhere = this.ownerWhere(table, userId);
    const where = ownerWhere && searchWhere ? { AND: [ownerWhere, searchWhere] } : ownerWhere ?? searchWhere;
    const sortField = opts.sortField && table.columns.some((c) => c.name === opts.sortField)
      ? opts.sortField
      : table.defaultSort?.field;
    const sortDir: 'asc' | 'desc' = opts.sortDir === 'asc' ? 'asc' : opts.sortDir === 'desc' ? 'desc' : table.defaultSort?.dir ?? 'desc';
    const orderBy = sortField ? { [sortField]: sortDir } : undefined;
    const rows = await this.model(table).findMany({ where, orderBy });
    return { table, rows };
  }

  private ownerWhere(table: TableMeta, userId: string) {
    if (!table.ownerScoped) return undefined;
    const field = table.ownerField ?? 'userId';
    return { [field]: userId };
  }

  private async assertOwnsRow(table: TableMeta, id: string, userId: string) {
    if (!table.ownerScoped) return;
    const field = table.ownerField ?? 'userId';
    const row = await this.model(table).findFirst({
      where: { [table.idField]: id, [field]: userId },
    });
    if (!row) throw new NotFoundException(`Row not found in ${table.name}: ${id}`);
  }
}
