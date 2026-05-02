import { Controller, Get } from '@nestjs/common';
import type { NotificationRule, NotificationEvent, NotificationRuleFilters } from '@tradeping/types';
import { PrismaService } from '../prisma/prisma.service';

@Controller('notifications/rules')
export class RulesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list() {
    const rows = await this.prisma.notificationRule.findMany({
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
    });
    const data: NotificationRule[] = rows.map((row) => ({
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
    }));
    return { success: true, data };
  }
}
