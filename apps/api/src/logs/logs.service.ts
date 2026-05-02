import { Injectable, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { CrawlerLog, LogLevel } from '@tradeping/types';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class LogsService implements OnModuleInit {
  private readonly maxLogs = 500;
  private logs: CrawlerLog[] = [];

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    // Load the last 500 logs from DB into memory
    const rows = await this.prisma.log.findMany({
      orderBy: { createdAt: 'desc' },
      take: this.maxLogs,
    });
    this.logs = rows.map((r) => ({
      id: r.id,
      timestamp: r.createdAt.toISOString(),
      level: r.level as LogLevel,
      message: r.message,
    }));
  }

  log(level: LogLevel, message: string): CrawlerLog {
    const entry: CrawlerLog = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      level,
      message,
    };
    this.logs.unshift(entry);
    if (this.logs.length > this.maxLogs) this.logs.length = this.maxLogs;

    // Persist to DB fire-and-forget; also trim old rows
    void this.prisma.log
      .create({ data: { id: entry.id, level, message } })
      .then(() =>
        this.prisma.log.count().then((count) => {
          if (count > this.maxLogs) {
            return this.prisma.log
              .findMany({ orderBy: { createdAt: 'asc' }, take: count - this.maxLogs, select: { id: true } })
              .then((old) =>
                this.prisma.log.deleteMany({ where: { id: { in: old.map((r) => r.id) } } }),
              );
          }
        }),
      )
      .catch(() => { /* non-fatal */ });

    return entry;
  }

  info(message: string) { return this.log('INFO', message); }
  warn(message: string) { return this.log('WARN', message); }
  error(message: string) { return this.log('ERROR', message); }
  success(message: string) { return this.log('SUCCESS', message); }

  findAll(): CrawlerLog[] {
    return this.logs;
  }
}
