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

const SAMPLE_ALERT: StockAlert = {
  id: 'sample-id',
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

  async findAll(): Promise<NotificationTemplate[]> {
    const rows = await this.prisma.notificationTemplate.findMany({ orderBy: { createdAt: 'asc' } });
    return rows.map(toTemplate);
  }

  async findOne(id: string): Promise<NotificationTemplate> {
    const row = await this.prisma.notificationTemplate.findUnique({ where: { id } });
    if (!row) throw new NotFoundException(`Template ${id} not found`);
    return toTemplate(row);
  }

  /** Resolve the body string for a given (event, channelId, optional templateId). */
  async resolveBody(opts: {
    templateId?: string | null;
    event: NotificationEvent;
    channelId: string;
    ctx: TemplateContext;
  }): Promise<{ body: string; subject: string | null }> {
    let template: NotificationTemplate | null = null;
    if (opts.templateId) {
      const row = await this.prisma.notificationTemplate.findUnique({ where: { id: opts.templateId } });
      if (row) template = toTemplate(row);
    }
    if (!template) {
      const row = await this.prisma.notificationTemplate.findFirst({
        where: { event: opts.event, channelId: opts.channelId, isDefault: true },
      });
      if (row) template = toTemplate(row);
    }
    if (!template) {
      const row = await this.prisma.notificationTemplate.findFirst({
        where: { event: opts.event, channelId: null, isDefault: true },
      });
      if (row) template = toTemplate(row);
    }
    const body = template?.body ?? DEFAULT_TEMPLATES[opts.event] ?? '';
    return {
      body: render(body, opts.ctx),
      subject: template?.subject ? render(template.subject, opts.ctx) : null,
    };
  }

  async create(dto: UpsertTemplateDto): Promise<NotificationTemplate> {
    this.validateEvent(dto.event);
    const row = await this.prisma.notificationTemplate.create({
      data: {
        name: dto.name.trim(),
        event: dto.event,
        channelId: dto.channelId ?? null,
        body: dto.body,
        subject: dto.subject ?? null,
        isDefault: dto.isDefault ?? false,
      },
    });
    return toTemplate(row);
  }

  async update(id: string, dto: Partial<UpsertTemplateDto>): Promise<NotificationTemplate> {
    if (dto.event) this.validateEvent(dto.event);
    const existing = await this.prisma.notificationTemplate.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Template ${id} not found`);
    const row = await this.prisma.notificationTemplate.update({
      where: { id },
      data: {
        name: dto.name?.trim() ?? existing.name,
        event: dto.event ?? existing.event,
        channelId: dto.channelId === undefined ? existing.channelId : dto.channelId,
        body: dto.body ?? existing.body,
        subject: dto.subject === undefined ? existing.subject : dto.subject,
        isDefault: dto.isDefault ?? existing.isDefault,
      },
    });
    return toTemplate(row);
  }

  async remove(id: string): Promise<{ id: string }> {
    const existing = await this.prisma.notificationTemplate.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Template ${id} not found`);
    await this.prisma.notificationTemplate.delete({ where: { id } });
    return { id };
  }

  preview(body: string, sampleEvent: NotificationEvent = 'alert.triggered'): string {
    const ctx: TemplateContext = {
      alert: SAMPLE_ALERT,
      price: 1255,
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
}
