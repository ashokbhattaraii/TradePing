import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from './app.module';
import { SettingsService } from './settings/settings.service';

function splitOrigins(value?: string | null): string[] {
  return (value ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function isLocalDevOrigin(origin: string): boolean {
  if (process.env.NODE_ENV === 'production') return false;

  try {
    const url = new URL(origin);
    if (!['http:', 'https:'].includes(url.protocol)) return false;

    return (
      url.hostname === 'localhost' ||
      url.hostname === '127.0.0.1' ||
      url.hostname === '0.0.0.0' ||
      url.hostname === '::1' ||
      /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(url.hostname) ||
      /^192\.168\.\d{1,3}\.\d{1,3}$/.test(url.hostname) ||
      /^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(url.hostname)
    );
  } catch {
    return false;
  }
}

function isAddressInUse(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'EADDRINUSE';
}

async function listenWithDevFallback(app: INestApplication, port: number, logger: Logger): Promise<number> {
  const maxAttempts = process.env.NODE_ENV === 'production' ? 1 : 10;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const nextPort = port + attempt;
    try {
      await app.listen(nextPort);
      return nextPort;
    } catch (error) {
      if (!isAddressInUse(error) || attempt === maxAttempts - 1) {
        throw error;
      }

      logger.warn(`Port ${nextPort} is already in use; trying ${nextPort + 1} for local development.`);
    }
  }

  throw new Error(`No available local development port found from ${port} to ${port + maxAttempts - 1}.`);
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const logger = new Logger('Bootstrap');
  const settings = app.get(SettingsService, { strict: false });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.enableCors({
    origin: (origin, callback) => {
      // Allow requests with no origin (curl, mobile apps, server-to-server)
      if (!origin) return callback(null, true);

      const allowedOrigins = [
        ...splitOrigins(process.env.FRONTEND_URL),
        ...splitOrigins(settings.get().frontendUrl),
      ];

      if (allowedOrigins.includes(origin)) return callback(null, true);

      // In development, allow Next/Vite/etc. to move to any local or LAN port.
      if (isLocalDevOrigin(origin)) return callback(null, true);

      callback(new Error(`CORS: origin not allowed — ${origin}`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  const configuredPort = Number(process.env.PORT ?? 4000);
  const port = await listenWithDevFallback(app, configuredPort, logger);
  logger.log(`TradePing API running on http://localhost:${port}`);
}

bootstrap().catch((err) => {
  console.error('[Bootstrap] Failed to start TradePing API:');
  console.error(err);
  process.exit(1);
});
