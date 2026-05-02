import { BadRequestException, Inject, Injectable, NotFoundException, forwardRef } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { STOCK_ALIASES, type StockAlert, type AlertPriority } from '@tradeping/types';
import { CreateAlertDto } from './dto/create-alert.dto';
import { LogsService } from '../logs/logs.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SettingsService } from '../settings/settings.service';

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
  userId: string | null;
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
    userId: row.userId,
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
    @Inject(forwardRef(() => SettingsService))
    private readonly settings: SettingsService,
  ) {}

  applyAlertSettings(settings: Partial<AlertRuleSettings>) {
    this.rules = { ...this.rules, ...settings };
  }

  /** Resolve per-user alert rule settings, falling back to globals. */
  private async rulesForUser(userId: string | null | undefined): Promise<AlertRuleSettings> {
    if (!userId) return this.rules;
    try {
      const s = await this.settings.getForUser(userId);
      return {
        autoDeleteTriggeredMinutes: s.alertAutoDeleteTriggeredMinutes,
        maxPerSymbol: s.alertMaxPerSymbol,
        expiryHours: s.alertExpiryHours,
        repeatAfterMinutes: s.alertRepeatAfterMinutes,
        notifyOnCreate: s.alertNotifyOnCreate,
        notifyOnExpiry: s.alertNotifyOnExpiry,
      };
    } catch {
      return this.rules;
    }
  }

  async findAll(userId: string): Promise<StockAlert[]> {
    await this.pruneAlerts(userId);
    const rows = await this.prisma.alert.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return rows
      .map(toAlert)
      .sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
  }

  async findActive(userId?: string): Promise<StockAlert[]> {
    await this.pruneAlerts(userId);
    const rows = await this.prisma.alert.findMany({
      where: { status: 'ACTIVE', ...(userId ? { userId } : {}) },
      orderBy: { createdAt: 'desc' },
    });
    return rows
      .map(toAlert)
      .sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
  }

  async create(dto: CreateAlertDto, userId: string): Promise<StockAlert> {
    const symbol = STOCK_ALIASES[dto.symbol] ?? dto.symbol;
    const rules = await this.rulesForUser(userId);
    if (rules.maxPerSymbol > 0) {
      const count = await this.prisma.alert.count({
        where: { symbol, status: 'ACTIVE', userId },
      });
      if (count >= rules.maxPerSymbol) {
        throw new BadRequestException(
          `Maximum ${rules.maxPerSymbol} active alert${rules.maxPerSymbol === 1 ? '' : 's'} per symbol`,
        );
      }
    }
    const row = await this.prisma.alert.create({
      data: {
        id: randomUUID(),
        userId,
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
    if (rules.notifyOnCreate || (await this.notifications.hasEnabledRulesForEvent('alert.created', userId))) {
      void this.notifications.notifyAlertCreated(alert);
    }
    return alert;
  }

  async remove(id: string, userId: string): Promise<{ id: string }> {
    const row = await this.prisma.alert.findFirst({ where: { id, userId } });
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
    const rules = await this.rulesForUser(row.userId);
    if (rules.repeatAfterMinutes > 0) {
      const repeatMin = rules.repeatAfterMinutes;
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
            if (a) this.logs.info(`Alert re-activated: ${a.symbol} (repeat every ${repeatMin}min)`);
          });
      }, repeatMin * 60_000);
    }
  }

  async updateLastChecked(id: string, price: number): Promise<void> {
    await this.prisma.alert.update({
      where: { id },
      data: { lastCheckedPrice: price },
    });
  }

  private async pruneAlerts(userId?: string): Promise<void> {
    const ownerWhere = userId ? { userId } : {};
    const rules = await this.rulesForUser(userId);
    const now = new Date();
    if (rules.autoDeleteTriggeredMinutes > 0) {
      const cutoff = new Date(now.getTime() - rules.autoDeleteTriggeredMinutes * 60_000);
      await this.prisma.alert.deleteMany({
        where: { ...ownerWhere, status: 'TRIGGERED', triggeredAt: { lt: cutoff } },
      });
    }
    if (rules.expiryHours > 0) {
      const cutoff = new Date(now.getTime() - rules.expiryHours * 3_600_000);

      if (rules.notifyOnExpiry || (await this.notifications.hasEnabledRulesForEvent('alert.expired', userId))) {
        const expired = await this.prisma.alert.findMany({
          where: { ...ownerWhere, status: 'ACTIVE', createdAt: { lt: cutoff } },
        });
        for (const row of expired) {
          void this.notifications.notifyAlertExpired(toAlert(row));
        }
      }

      await this.prisma.alert.deleteMany({
        where: { ...ownerWhere, status: 'ACTIVE', createdAt: { lt: cutoff } },
      });
    }
  }
}
