import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { SettingsService } from '../settings/settings.service';
import { PrismaService } from '../prisma/prisma.service';

export interface Watchlist {
  id: string;
  name: string;
  symbols: string[];
  symbolAddedAt: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

type WatchlistRow = {
  id: string;
  userId: string | null;
  name: string;
  symbols: string[];
  symbolAddedAt: unknown;
  createdAt: Date;
  updatedAt: Date;
};

function toDto(row: WatchlistRow): Watchlist {
  return {
    id: row.id,
    name: row.name,
    symbols: row.symbols,
    symbolAddedAt: (row.symbolAddedAt as Record<string, string>) ?? {},
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Injectable()
export class WatchlistService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  private async ensureDefault(userId: string) {
    const existing = await this.prisma.watchlist.findFirst({ where: { userId }, orderBy: { createdAt: 'asc' } });
    if (existing) return;

    const now = new Date().toISOString();
    await this.prisma.watchlist.create({
      data: {
        id: randomUUID(),
        userId,
        name: 'My Watchlist',
        symbols: ['NABIL', 'GBIME', 'SANIMA', 'NRIC', 'CIT'],
        symbolAddedAt: { NABIL: now, GBIME: now, SANIMA: now, NRIC: now, CIT: now },
      },
    });
  }

  private pruneExpiredSymbols(list: Watchlist, expiryDays: number): Watchlist {
    if (expiryDays <= 0) return list;
    const cutoff = Date.now() - expiryDays * 86_400_000;
    const prunedSymbols = list.symbols.filter((sym) => {
      const addedAt = list.symbolAddedAt[sym];
      return !addedAt || new Date(addedAt).getTime() > cutoff;
    });
    if (prunedSymbols.length === list.symbols.length) return list;
    const prunedAddedAt = Object.fromEntries(
      Object.entries(list.symbolAddedAt).filter(([sym]) => prunedSymbols.includes(sym)),
    );
    return { ...list, symbols: prunedSymbols, symbolAddedAt: prunedAddedAt };
  }

  async findAll(userId: string): Promise<Watchlist[]> {
    await this.ensureDefault(userId);
    const { watchlistSymbolExpiryDays } = this.settings.get();
    const rows = await this.prisma.watchlist.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });
    const lists = rows.map(toDto);
    if (watchlistSymbolExpiryDays > 0) {
      const pruned = lists.map((l) => this.pruneExpiredSymbols(l, watchlistSymbolExpiryDays));
      await Promise.all(
        pruned.map((l, i) => {
          if (l.symbols.length !== lists[i].symbols.length) {
            return this.prisma.watchlist.update({
              where: { id: l.id },
              data: { symbols: l.symbols, symbolAddedAt: l.symbolAddedAt },
            });
          }
        }),
      );
      return pruned;
    }
    return lists;
  }

  async findOne(id: string, userId: string): Promise<Watchlist> {
    const row = await this.prisma.watchlist.findFirst({ where: { id, userId } });
    if (!row) throw new NotFoundException(`Watchlist "${id}" not found`);
    return toDto(row);
  }

  async create(name: string, userId: string): Promise<Watchlist> {
    if (!name?.trim()) throw new BadRequestException('name is required');
    const count = await this.prisma.watchlist.count({ where: { userId } });
    if (count >= 20) throw new BadRequestException('Maximum 20 watchlists allowed');
    const row = await this.prisma.watchlist.create({
      data: { id: randomUUID(), userId, name: name.trim(), symbols: [], symbolAddedAt: {} },
    });
    return toDto(row);
  }

  async rename(id: string, name: string, userId: string): Promise<Watchlist> {
    if (!name?.trim()) throw new BadRequestException('name is required');
    await this.findOne(id, userId);
    const row = await this.prisma.watchlist.update({
      where: { id },
      data: { name: name.trim() },
    });
    return toDto(row);
  }

  async remove(id: string, userId: string): Promise<{ id: string }> {
    if (id === 'default') throw new BadRequestException('Cannot delete the default watchlist');
    await this.findOne(id, userId);
    await this.prisma.watchlist.delete({ where: { id } });
    return { id };
  }

  async addSymbol(id: string, symbol: string, userId: string): Promise<Watchlist> {
    const normalized = symbol.trim().toUpperCase();
    if (!/^[A-Z0-9]{1,12}$/.test(normalized)) {
      throw new BadRequestException('Invalid symbol');
    }
    const { watchlistMaxSymbolsPerList } = this.settings.get();
    const list = await this.findOne(id, userId);
    if (list.symbols.includes(normalized)) return list;
    const maxSymbols = watchlistMaxSymbolsPerList > 0 ? watchlistMaxSymbolsPerList : 100;
    if (list.symbols.length >= maxSymbols) {
      throw new BadRequestException(`Maximum ${maxSymbols} symbols per watchlist`);
    }
    const newSymbols = [...list.symbols, normalized];
    const newAddedAt = { ...list.symbolAddedAt, [normalized]: new Date().toISOString() };
    const row = await this.prisma.watchlist.update({
      where: { id },
      data: { symbols: newSymbols, symbolAddedAt: newAddedAt },
    });
    return toDto(row);
  }

  async removeSymbol(id: string, symbol: string, userId: string): Promise<Watchlist> {
    const normalized = symbol.trim().toUpperCase();
    const list = await this.findOne(id, userId);
    const newSymbols = list.symbols.filter((s) => s !== normalized);
    const newAddedAt = { ...list.symbolAddedAt };
    delete newAddedAt[normalized];
    const row = await this.prisma.watchlist.update({
      where: { id },
      data: { symbols: newSymbols, symbolAddedAt: newAddedAt },
    });
    return toDto(row);
  }

  async reorderSymbols(id: string, symbols: string[], userId: string): Promise<Watchlist> {
    const list = await this.findOne(id, userId);
    const valid = new Set(list.symbols);
    const newSymbols = symbols.filter((s) => valid.has(s));
    const row = await this.prisma.watchlist.update({
      where: { id },
      data: { symbols: newSymbols },
    });
    return toDto(row);
  }
}
