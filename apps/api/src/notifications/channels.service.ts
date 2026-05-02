import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { NotificationChannel, NotificationChannelType } from '@tradeping/types';
import { NOTIFICATION_CHANNEL_TYPES } from '@tradeping/types';
import { PrismaService } from '../prisma/prisma.service';
import { dispatch, type DispatchResult } from './dispatchers';
import { DEFAULT_TEMPLATES, render } from './template-engine';

const SECRET_KEYS = new Set(['authToken', 'botToken', 'apiKey', 'password', 'token']);
const REDACTED = '••••••••';

function toChannel(row: {
  id: string;
  name: string;
  type: string;
  enabled: boolean;
  config: unknown;
  createdAt: Date;
  updatedAt: Date;
}): NotificationChannel {
  return {
    id: row.id,
    name: row.name,
    type: row.type as NotificationChannelType,
    enabled: row.enabled,
    config: redactSecrets((row.config as Record<string, unknown>) ?? {}),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function redactSecrets(config: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(config)) {
    out[k] = SECRET_KEYS.has(k) && v ? REDACTED : v;
  }
  return out;
}

function mergeConfig(existing: Record<string, unknown>, incoming: Record<string, unknown>): Record<string, unknown> {
  const out = { ...existing };
  for (const [k, v] of Object.entries(incoming)) {
    // Preserve existing secret if client sent the redacted placeholder.
    if (SECRET_KEYS.has(k) && v === REDACTED) continue;
    out[k] = v;
  }
  return out;
}

export interface UpsertChannelDto {
  name: string;
  type: NotificationChannelType;
  enabled?: boolean;
  config?: Record<string, unknown>;
}

@Injectable()
export class ChannelsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(userId: string): Promise<NotificationChannel[]> {
    const rows = await this.prisma.notificationChannel.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toChannel);
  }

  async findOne(id: string, userId: string): Promise<NotificationChannel> {
    const row = await this.prisma.notificationChannel.findFirst({ where: { id, userId } });
    if (!row) throw new NotFoundException(`Channel ${id} not found`);
    return toChannel(row);
  }

  /** Internal use — returns config WITHOUT redaction for actual sending. */
  async findOneRaw(
    id: string,
    userId?: string | null,
  ): Promise<{ id: string; type: NotificationChannelType; enabled: boolean; config: Record<string, unknown> } | null> {
    const row = await this.prisma.notificationChannel.findFirst({
      where: { id, ...(userId ? { userId } : {}) },
    });
    if (!row) return null;
    return {
      id: row.id,
      type: row.type as NotificationChannelType,
      enabled: row.enabled,
      config: (row.config as Record<string, unknown>) ?? {},
    };
  }

  async create(dto: UpsertChannelDto, userId: string): Promise<NotificationChannel> {
    this.validateType(dto.type);
    const row = await this.prisma.notificationChannel.create({
      data: {
        name: dto.name.trim() || dto.type,
        userId,
        type: dto.type,
        enabled: dto.enabled ?? true,
        config: (dto.config ?? {}) as object,
      },
    });
    return toChannel(row);
  }

  async update(id: string, dto: Partial<UpsertChannelDto>, userId: string): Promise<NotificationChannel> {
    if (dto.type) this.validateType(dto.type);
    const existing = await this.prisma.notificationChannel.findFirst({ where: { id, userId } });
    if (!existing) throw new NotFoundException(`Channel ${id} not found`);
    const mergedConfig = dto.config
      ? mergeConfig((existing.config as Record<string, unknown>) ?? {}, dto.config)
      : (existing.config as Record<string, unknown>);
    const row = await this.prisma.notificationChannel.update({
      where: { id },
      data: {
        name: dto.name?.trim() || existing.name,
        type: dto.type ?? existing.type,
        enabled: dto.enabled ?? existing.enabled,
        config: mergedConfig as object,
      },
    });
    return toChannel(row);
  }

  async remove(id: string, userId: string): Promise<{ id: string }> {
    const existing = await this.prisma.notificationChannel.findFirst({ where: { id, userId } });
    if (!existing) throw new NotFoundException(`Channel ${id} not found`);
    await this.prisma.notificationChannel.delete({ where: { id } });
    return { id };
  }

  async test(id: string, userId: string): Promise<DispatchResult> {
    const raw = await this.findOneRaw(id, userId);
    if (!raw) throw new NotFoundException(`Channel ${id} not found`);
    const body = render(DEFAULT_TEMPLATES['system.test'], {
      event: 'system.test',
      timestamp: new Date().toISOString(),
    });
    return dispatch(raw.type, raw.config, { body });
  }

  private validateType(type: string) {
    if (!NOTIFICATION_CHANNEL_TYPES.includes(type as NotificationChannelType)) {
      throw new BadRequestException(`Unsupported channel type: ${type}`);
    }
  }
}
