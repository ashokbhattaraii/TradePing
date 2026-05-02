import { BadRequestException, Inject, Injectable, NotFoundException, forwardRef } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { STOCK_ALIASES, type StockAlert, type AlertPriority } from '@tradeping/types';
import { CreateAlertDto } from './dto/create-alert.dto';
import { LogsService } from '../logs/logs.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

interface AlertRuleSettings {
  autoDeleteTriggeredMinutes: number;
  maxPerSymbol: number;
  expiryHours: number;
  repeatAfterMinutes: number;
  notifyOnCreate: boolean;
  notifyOnExpiry: boolean;
}

const PRIORITY_ORDER: Record<AlertPriority, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };

function toAlert(row: {
  id: string;
  symbol: string;
  targetPrice: number;
  condition: string;
  status: string;
  priority: string;
  note: string | null;
  lastCheckedPrice: number | null;
  createdAt: Date;
  triggeredAt: Date | null;
}): StockAlert {
  return {
    id: row.id,
    symbol: row.symbol,
    targetPrice: row.targetPrice,
    condition: row.condition as StockAlert['condition'],
    status: row.status as StockAlert['status'],
    priority: row.priority as StockAlert['priority'],
    note: row.note,
    lastCheckedPrice: row.lastCheckedPrice,
    createdAt: row.createdAt.toISOString(),
    triggeredAt: row.triggeredAt?.toISOString() ?? null,
  };
}

@Injectable()
export class AlertsService {
  private rules: AlertRuleSettings = {
    autoDeleteTriggeredMinutes: 0,
    maxPerSymbol: 0,
    expiryHours: 0,
    repeatAfterMinutes: 0,
    notifyOnCreate: false,
    notifyOnExpiry: false,
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly logs: LogsService,
    @Inject(forwardRef(() => NotificationsService))
    private readonly notifications: NotificationsService,
  ) {}

  applyAlertSettings(settings: Partial<AlertRuleSettings>) {
    this.rules = { ...this.rules, ...settings };
  }

  async findAll(): Promise<StockAlert[]> {
    await this.pruneAlerts();
    const rows = await this.prisma.alert.findMany({ orderBy: { createdAt: 'desc' } });
    return rows
      .map(toAlert)
      .sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
  }

  async findActive(): Promise<StockAlert[]> {
    await this.pruneAlerts();
    const rows = await this.prisma.alert.findMany({
      where: { status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
    });
    return rows
      .map(toAlert)
      .sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
  }

  async create(dto: CreateAlertDto): Promise<StockAlert> {
    const symbol = STOCK_ALIASES[dto.symbol] ?? dto.symbol;
    if (this.rules.maxPerSymbol > 0) {
      const count = await this.prisma.alert.count({
        where: { symbol, status: 'ACTIVE' },
      });
      if (count >= this.rules.maxPerSymbol) {
        throw new BadRequestException(
          `Maximum ${this.rules.maxPerSymbol} active alert${this.rules.maxPerSymbol === 1 ? '' : 's'} per symbol`,
        );
      }
    }
    const row = await this.prisma.alert.create({
      data: {
        id: randomUUID(),
        symbol,
        targetPrice: dto.targetPrice,
        condition: dto.condition,
        status: 'ACTIVE',
        priority: dto.priority ?? 'MEDIUM',
        note: dto.note?.trim() || null,
      },
    });
    this.logs.info(`Alert created for ${row.symbol} ${row.condition} Rs. ${row.targetPrice}`);
    const alert = toAlert(row);
    if (this.rules.notifyOnCreate) {
      void this.notifications.notifyAlertCreated(alert);
    }
    return alert;
  }

  async remove(id: string): Promise<{ id: string }> {
    const row = await this.prisma.alert.findUnique({ where: { id } });
    if (!row) throw new NotFoundException(`Alert ${id} not found`);
    await this.prisma.alert.delete({ where: { id } });
    this.logs.info(`Alert removed for ${row.symbol}`);
    return { id };
  }

  async markTriggered(id: string, price: number): Promise<void> {
    const row = await this.prisma.alert.update({
      where: { id },
      data: { status: 'TRIGGERED', triggeredAt: new Date(), lastCheckedPrice: price },
    });
    this.logs.info(
      `Alert triggered: ${row.symbol} ${row.condition} Rs. ${row.targetPrice} @ Rs. ${price}${row.priority !== 'MEDIUM' ? ` [${row.priority}]` : ''}`,
    );
    if (this.rules.repeatAfterMinutes > 0) {
      setTimeout(() => {
        void this.prisma.alert
          .findUnique({ where: { id } })
          .then((a) => {
            if (a && a.status === 'TRIGGERED') {
              return this.prisma.alert.update({
                where: { id },
                data: { status: 'ACTIVE', triggeredAt: null, lastCheckedPrice: null },
              });
            }
          })
          .then((a) => {
            if (a) this.logs.info(`Alert re-activated: ${a.symbol} (repeat every ${this.rules.repeatAfterMinutes}min)`);
          });
      }, this.rules.repeatAfterMinutes * 60_000);
    }
  }

  async updateLastChecked(id: string, price: number): Promise<void> {
    await this.prisma.alert.update({
      where: { id },
      data: { lastCheckedPrice: price },
    });
  }

  private async pruneAlerts(): Promise<void> {
    const now = new Date();
    if (this.rules.autoDeleteTriggeredMinutes > 0) {
      const cutoff = new Date(now.getTime() - this.rules.autoDeleteTriggeredMinutes * 60_000);
      await this.prisma.alert.deleteMany({
        where: { status: 'TRIGGERED', triggeredAt: { lt: cutoff } },
      });
    }
    if (this.rules.expiryHours > 0) {
      const cutoff = new Date(now.getTime() - this.rules.expiryHours * 3_600_000);
      
      if (this.rules.notifyOnExpiry) {
        const expired = await this.prisma.alert.findMany({
          where: { status: 'ACTIVE', createdAt: { lt: cutoff } },
        });
        for (const row of expired) {
          void this.notifications.notifyAlertExpired(toAlert(row));
        }
      }

      await this.prisma.alert.deleteMany({
        where: { status: 'ACTIVE', createdAt: { lt: cutoff } },
      });
    }
  }
}
