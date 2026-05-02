import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type {
  AlertCondition,
  AlertPriority,
  NotificationEvent,
  NotificationRule,
  NotificationRuleFilters,
} from '@tradeping/types';
import { ALERT_CONDITIONS, ALERT_PRIORITIES, NOTIFICATION_EVENTS } from '@tradeping/types';
import { PrismaService } from '../prisma/prisma.service';

export interface UpsertRuleDto {
  name: string;
  event: NotificationEvent;
  enabled?: boolean;
  priority?: number;
  filters?: NotificationRuleFilters;
  channelId: string;
  templateId?: string | null;
  cooldownMin?: number;
}

type RuleRow = {
  id: string;
  userId: string | null;
  name: string;
  event: string;
  enabled: boolean;
  priority: number;
  filters: unknown;
  channelId: string;
  templateId: string | null;
  cooldownMin: number;
  createdAt: Date;
  updatedAt: Date;
};

export function toRule(row: RuleRow): NotificationRule {
  return {
    id: row.id,
    name: row.name,
    event: row.event as NotificationEvent,
    enabled: row.enabled,
    priority: row.priority,
    filters: (row.filters ?? {}) as NotificationRuleFilters,
    channelId: row.channelId,
    templateId: row.templateId,
    cooldownMin: row.cooldownMin,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Injectable()
export class RulesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(userId: string): Promise<NotificationRule[]> {
    const rows = await this.prisma.notificationRule.findMany({
      where: { userId },
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
    });
    return rows.map(toRule);
  }

  async create(dto: UpsertRuleDto, userId: string): Promise<NotificationRule> {
    const data = await this.normalize(dto, true, userId);
    const row = await this.prisma.notificationRule.create({ data });
    return toRule(row);
  }

  async update(id: string, dto: Partial<UpsertRuleDto>, userId: string): Promise<NotificationRule> {
    const existing = await this.prisma.notificationRule.findFirst({ where: { id, userId } });
    if (!existing) throw new NotFoundException(`Rule ${id} not found`);
    const data = await this.normalize(
      {
        name: dto.name ?? existing.name,
        event: dto.event ?? (existing.event as NotificationEvent),
        enabled: dto.enabled ?? existing.enabled,
        priority: dto.priority ?? existing.priority,
        filters: dto.filters ?? ((existing.filters ?? {}) as NotificationRuleFilters),
        channelId: dto.channelId ?? existing.channelId,
        templateId: dto.templateId === undefined ? existing.templateId : dto.templateId,
        cooldownMin: dto.cooldownMin ?? existing.cooldownMin,
      },
      false,
      userId,
    );
    const row = await this.prisma.notificationRule.update({ where: { id }, data });
    return toRule(row);
  }

  async remove(id: string, userId: string): Promise<{ id: string }> {
    const existing = await this.prisma.notificationRule.findFirst({ where: { id, userId } });
    if (!existing) throw new NotFoundException(`Rule ${id} not found`);
    await this.prisma.notificationRule.delete({ where: { id } });
    return { id };
  }

  private async normalize(dto: UpsertRuleDto, isCreate: boolean, userId: string) {
    const event = this.validateEvent(dto.event);
    const channelId = await this.validateChannel(dto.channelId, userId);
    const templateId = await this.validateTemplate(dto.templateId ?? null, event, channelId, userId);

    return {
      name: this.validateName(dto.name, isCreate),
      userId,
      event,
      enabled: dto.enabled ?? true,
      priority: this.validatePriority(dto.priority ?? 0),
      filters: this.validateFilters(dto.filters ?? {}) as Prisma.InputJsonValue,
      channelId,
      templateId,
      cooldownMin: this.validateCooldown(dto.cooldownMin ?? 0),
    };
  }

  private validateEvent(event: string): NotificationEvent {
    if (!NOTIFICATION_EVENTS.includes(event as NotificationEvent)) {
      throw new BadRequestException(`Unknown event: ${event}`);
    }
    return event as NotificationEvent;
  }

  private validateName(name: string, isCreate: boolean): string {
    const trimmed = String(name ?? '').trim();
    if (!trimmed && isCreate) throw new BadRequestException('Rule name is required');
    if (trimmed.length > 80) throw new BadRequestException('Rule name must be 80 characters or less');
    return trimmed;
  }

  private async validateChannel(channelId: string, userId: string): Promise<string> {
    const value = String(channelId ?? '').trim();
    if (!value) throw new BadRequestException('Notification channel is required');
    const channel = await this.prisma.notificationChannel.findFirst({ where: { id: value, userId } });
    if (!channel) throw new BadRequestException(`Unknown notification channel: ${value}`);
    return value;
  }

  private async validateTemplate(
    templateId: string | null,
    event: NotificationEvent,
    channelId: string,
    userId: string,
  ): Promise<string | null> {
    if (!templateId) return null;
    const template = await this.prisma.notificationTemplate.findFirst({ where: { id: templateId, userId } });
    if (!template) throw new BadRequestException(`Unknown notification template: ${templateId}`);
    if (template.event !== event) {
      throw new BadRequestException('Template event must match the rule event');
    }
    if (template.channelId && template.channelId !== channelId) {
      throw new BadRequestException('Template channel must match the rule channel');
    }
    return templateId;
  }

  private validatePriority(priority: number): number {
    const value = Number(priority);
    if (!Number.isInteger(value) || value < 0 || value > 100) {
      throw new BadRequestException('Rule priority must be an integer from 0 to 100');
    }
    return value;
  }

  private validateCooldown(cooldownMin: number): number {
    const value = Number(cooldownMin);
    if (!Number.isInteger(value) || value < 0 || value > 1440) {
      throw new BadRequestException('Cooldown must be an integer from 0 to 1440 minutes');
    }
    return value;
  }

  private validateFilters(filters: unknown): NotificationRuleFilters {
    if (filters === null || filters === undefined) return {};
    if (typeof filters !== 'object' || Array.isArray(filters)) {
      throw new BadRequestException('Rule filters must be an object');
    }

    const input = filters as Record<string, unknown>;
    const allowedKeys = new Set(['priorities', 'symbols', 'conditions', 'minTargetPrice', 'maxTargetPrice']);
    for (const key of Object.keys(input)) {
      if (!allowedKeys.has(key)) throw new BadRequestException(`Unsupported rule filter: ${key}`);
    }

    const out: NotificationRuleFilters = {};
    if ('priorities' in input) {
      out.priorities = this.validateStringEnumArray<AlertPriority>(
        input.priorities,
        ALERT_PRIORITIES,
        'priorities',
      );
    }
    if ('conditions' in input) {
      out.conditions = this.validateStringEnumArray<AlertCondition>(
        input.conditions,
        ALERT_CONDITIONS,
        'conditions',
      );
    }
    if ('symbols' in input) {
      out.symbols = this.validateSymbols(input.symbols);
    }
    if ('minTargetPrice' in input) {
      out.minTargetPrice = this.validatePrice(input.minTargetPrice, 'minTargetPrice');
    }
    if ('maxTargetPrice' in input) {
      out.maxTargetPrice = this.validatePrice(input.maxTargetPrice, 'maxTargetPrice');
    }
    if (
      out.minTargetPrice !== undefined &&
      out.maxTargetPrice !== undefined &&
      out.minTargetPrice > out.maxTargetPrice
    ) {
      throw new BadRequestException('minTargetPrice cannot be greater than maxTargetPrice');
    }
    return out;
  }

  private validateStringEnumArray<T extends string>(value: unknown, allowed: readonly T[], label: string): T[] {
    if (!Array.isArray(value)) throw new BadRequestException(`${label} must be an array`);
    const uniq = new Set<T>();
    for (const raw of value) {
      const item = String(raw).trim().toUpperCase() as T;
      if (!allowed.includes(item)) throw new BadRequestException(`Unsupported ${label} value: ${raw}`);
      uniq.add(item);
    }
    return [...uniq];
  }

  private validateSymbols(value: unknown): string[] {
    if (!Array.isArray(value)) throw new BadRequestException('symbols must be an array');
    const uniq = new Set<string>();
    for (const raw of value) {
      const symbol = String(raw).trim().toUpperCase();
      if (!/^[A-Z0-9.-]{1,20}$/.test(symbol)) {
        throw new BadRequestException(`Invalid stock symbol: ${raw}`);
      }
      uniq.add(symbol);
    }
    return [...uniq];
  }

  private validatePrice(value: unknown, label: string): number {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) throw new BadRequestException(`${label} must be a positive number`);
    return n;
  }
}
