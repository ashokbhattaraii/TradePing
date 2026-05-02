import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { NotificationEvent, NotificationTemplate, StockAlert } from '@tradeping/types';
import { NOTIFICATION_EVENTS } from '@tradeping/types';
import { PrismaService } from '../prisma/prisma.service';
import { DEFAULT_TEMPLATES, render, type TemplateContext } from './template-engine';

function toTemplate(row: {
  id: string;
  name: string;
  event: string;
  channelId: string | null;
  body: string;
  subject: string | null;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}): NotificationTemplate {
  return {
    id: row.id,
    name: row.name,
    event: row.event as NotificationEvent,
    channelId: row.channelId,
    body: row.body,
    subject: row.subject,
    isDefault: row.isDefault,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export interface UpsertTemplateDto {
  name: string;
  event: NotificationEvent;
  channelId?: string | null;
  body: string;
  subject?: string | null;
  isDefault?: boolean;
}

const MAX_TEMPLATE_LENGTH = 1000;
const COMMON_TEMPLATE_KEYS = new Set(['event', 'timestamp']);
const ALERT_TEMPLATE_KEYS = new Set([
  'alert.symbol',
  'alert.condition',
  'alert.targetPrice',
  'alert.priority',
  'alert.note',
  'alert.status',
  'alert.lastCheckedPrice',
  'alert.createdAt',
  'alert.triggeredAt',
  'price',
  'symbol',
  'condition',
  'target',
  'note',
]);

const SAMPLE_ALERT: StockAlert = {
  id: 'sample-id',
  userId: 'sample-user-id',
  symbol: 'NABIL',
  targetPrice: 1250,
  condition: 'ABOVE',
  status: 'TRIGGERED',
  priority: 'HIGH',
  note: 'Buy zone',
  lastCheckedPrice: 1255,
  createdAt: new Date().toISOString(),
  triggeredAt: new Date().toISOString(),
};

@Injectable()
export class TemplatesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(userId: string): Promise<NotificationTemplate[]> {
    const rows = await this.prisma.notificationTemplate.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toTemplate);
  }

  async findOne(id: string, userId: string): Promise<NotificationTemplate> {
    const row = await this.prisma.notificationTemplate.findFirst({ where: { id, userId } });
    if (!row) throw new NotFoundException(`Template ${id} not found`);
    return toTemplate(row);
  }

  /** Resolve the body string for a given (event, channelId, optional templateId). */
  async resolveBody(opts: {
    templateId?: string | null;
    event: NotificationEvent;
    channelId: string;
    userId?: string | null;
    ctx: TemplateContext;
  }): Promise<{ body: string; subject: string | null }> {
    let template: NotificationTemplate | null = null;
    const ownerWhere = opts.userId ? { userId: opts.userId } : {};
    if (opts.templateId) {
      const row = await this.prisma.notificationTemplate.findFirst({
        where: { id: opts.templateId, ...ownerWhere },
      });
      if (row) template = toTemplate(row);
    }
    if (!template) {
      const row = await this.prisma.notificationTemplate.findFirst({
        where: { ...ownerWhere, event: opts.event, channelId: opts.channelId, isDefault: true },
      });
      if (row) template = toTemplate(row);
    }
    if (!template) {
      const row = await this.prisma.notificationTemplate.findFirst({
        where: { ...ownerWhere, event: opts.event, channelId: null, isDefault: true },
      });
      if (row) template = toTemplate(row);
    }
    const body = template?.body ?? DEFAULT_TEMPLATES[opts.event] ?? '';
    return {
      body: render(body, opts.ctx),
      subject: template?.subject ? render(template.subject, opts.ctx) : null,
    };
  }

  async create(dto: UpsertTemplateDto, userId: string): Promise<NotificationTemplate> {
    this.validateEvent(dto.event);
    await this.validateChannel(dto.channelId ?? null, userId);
    const data = {
      name: this.validateName(dto.name),
      userId,
      event: dto.event,
      channelId: dto.channelId ?? null,
      body: this.validateTemplateText(dto.body, dto.event, 'body'),
      subject: dto.subject ? this.validateTemplateText(dto.subject, dto.event, 'subject') : null,
      isDefault: dto.isDefault ?? false,
    };
    const row = data.isDefault
      ? await this.prisma.$transaction(async (tx) => {
          await tx.notificationTemplate.updateMany({
            where: { userId, event: data.event, channelId: data.channelId },
            data: { isDefault: false },
          });
          return tx.notificationTemplate.create({ data });
        })
      : await this.prisma.notificationTemplate.create({ data });
    return toTemplate(row);
  }

  async update(id: string, dto: Partial<UpsertTemplateDto>, userId: string): Promise<NotificationTemplate> {
    if (dto.event) this.validateEvent(dto.event);
    const existing = await this.prisma.notificationTemplate.findFirst({ where: { id, userId } });
    if (!existing) throw new NotFoundException(`Template ${id} not found`);
    const event = dto.event ?? (existing.event as NotificationEvent);
    const channelId = dto.channelId === undefined ? existing.channelId : dto.channelId;
    await this.validateChannel(channelId, userId);
    const data = {
      name: dto.name === undefined ? existing.name : this.validateName(dto.name),
      event,
      channelId,
      body: dto.body === undefined ? existing.body : this.validateTemplateText(dto.body, event, 'body'),
      subject:
        dto.subject === undefined
          ? existing.subject
          : dto.subject
            ? this.validateTemplateText(dto.subject, event, 'subject')
            : null,
      isDefault: dto.isDefault ?? existing.isDefault,
    };
    const row = data.isDefault
      ? await this.prisma.$transaction(async (tx) => {
          await tx.notificationTemplate.updateMany({
            where: { userId, event: data.event, channelId: data.channelId, id: { not: id } },
            data: { isDefault: false },
          });
          return tx.notificationTemplate.update({ where: { id }, data });
        })
      : await this.prisma.notificationTemplate.update({ where: { id }, data });
    return toTemplate(row);
  }

  async remove(id: string, userId: string): Promise<{ id: string }> {
    const existing = await this.prisma.notificationTemplate.findFirst({ where: { id, userId } });
    if (!existing) throw new NotFoundException(`Template ${id} not found`);
    await this.prisma.notificationTemplate.delete({ where: { id } });
    return { id };
  }

  preview(body: string, sampleEvent: NotificationEvent = 'alert.triggered'): string {
    this.validateEvent(sampleEvent);
    this.validateTemplateText(body, sampleEvent, 'body');
    const ctx: TemplateContext = {
      alert: SAMPLE_ALERT,
      price: 1255,
      symbol: SAMPLE_ALERT.symbol,
      condition: SAMPLE_ALERT.condition,
      target: SAMPLE_ALERT.targetPrice,
      note: SAMPLE_ALERT.note,
      event: sampleEvent,
      timestamp: new Date().toISOString(),
    };
    return render(body, ctx);
  }

  defaults(): Record<NotificationEvent, string> {
    return DEFAULT_TEMPLATES as Record<NotificationEvent, string>;
  }

  private validateEvent(event: string) {
    if (!NOTIFICATION_EVENTS.includes(event as NotificationEvent)) {
      throw new BadRequestException(`Unknown event: ${event}`);
    }
  }

  private validateName(name: string): string {
    const trimmed = String(name ?? '').trim();
    if (!trimmed) throw new BadRequestException('Template name is required');
    if (trimmed.length > 80) throw new BadRequestException('Template name must be 80 characters or less');
    return trimmed;
  }

  private async validateChannel(channelId: string | null | undefined, userId: string): Promise<void> {
    if (!channelId) return;
    const channel = await this.prisma.notificationChannel.findFirst({ where: { id: channelId, userId } });
    if (!channel) throw new BadRequestException(`Unknown notification channel: ${channelId}`);
  }

  private validateTemplateText(text: string, event: NotificationEvent, label: string): string {
    const value = String(text ?? '').trim();
    if (!value) throw new BadRequestException(`Template ${label} is required`);
    if (value.length > MAX_TEMPLATE_LENGTH) {
      throw new BadRequestException(`Template ${label} must be ${MAX_TEMPLATE_LENGTH} characters or less`);
    }

    const allowed = new Set(COMMON_TEMPLATE_KEYS);
    if (event.startsWith('alert.')) {
      for (const key of ALERT_TEMPLATE_KEYS) allowed.add(key);
    }

    const tags = Array.from(value.matchAll(/\{\{\s*(#|\/)?\s*([\w.]+)\s*\}\}/g));
    const stripped = value.replace(/\{\{\s*(#|\/)?\s*([\w.]+)\s*\}\}/g, '');
    if (stripped.includes('{{') || stripped.includes('}}')) {
      throw new BadRequestException('Template tags must use {{field}} or {{#field}}{{/field}}');
    }

    const stack: string[] = [];
    for (const match of tags) {
      const marker = match[1];
      const key = match[2];
      if (!allowed.has(key)) {
        throw new BadRequestException(`Unsupported template field: ${key}`);
      }
      if (marker === '#') {
        stack.push(key);
      } else if (marker === '/') {
        const open = stack.pop();
        if (open !== key) throw new BadRequestException(`Template section {{#${key}}} is not balanced`);
      }
    }
    if (stack.length > 0) throw new BadRequestException(`Template section {{#${stack[stack.length - 1]}}} is not closed`);

    return value;
  }
}
