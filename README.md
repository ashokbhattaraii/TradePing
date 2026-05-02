# TradePing

A crawler-based **NEPSE stock price alert system**. Pick a stock, set a target price, choose a condition, and TradePing's background crawler watches the price for you and updates the dashboard in real time.

> Prototype build — Google sign-in protects the dashboard and API.

## Features

- Set price alerts (`ABOVE` / `BELOW` / `EQUAL`) for 10 sample NEPSE stocks
- Background crawler runs every 30 seconds (configurable)
- Live, terminal-style log stream of every crawler event
- Auto-refreshing dashboard (alerts + logs poll every 5 s)
- Manual "Run check now" trigger
- Google OAuth sign-in for dashboard and API access
- Graceful **mock-price fallback** when the live crawl fails
- Vercel/Linear-inspired dark dashboard with glassmorphism + framer-motion

## Tech stack

| Layer       | Tech                                                |
|-------------|-----------------------------------------------------|
| Monorepo    | Turborepo + pnpm workspaces                         |
| Frontend    | Next.js 15 (App Router), TypeScript, Tailwind, framer-motion, lucide-react |
| Backend     | NestJS 10, TypeScript, class-validator, @nestjs/schedule |
| Crawler     | Playwright (chromium, headless)                     |
| Shared      | `@tradeping/types` workspace package                |

## Project structure

```
tradeping/
├── apps/
│   ├── web/                        # Next.js dashboard (port 3000)
│   │   └── src/
│   │       ├── app/                # layout.tsx, page.tsx, globals.css
│   │       ├── components/         # Hero, StatusCards, AlertForm, AlertList, LogsPanel, etc.
│   │       │   └── ui/             # Button, Card, Badge, Input, Select, Toast
│   │       ├── hooks/use-poll.ts   # Generic polling hook
│   │       └── lib/api.ts          # API client + utils
│   └── api/                        # NestJS backend (port 4000)
│       └── src/
│           ├── main.ts             # Bootstrap, ValidationPipe, CORS
│           ├── app.module.ts       # Wires Config + Schedule + feature modules
│           ├── health/             # GET /health
│           ├── stocks/             # GET /stocks
│           ├── alerts/             # CRUD on /alerts (in-memory)
│           ├── crawler/            # Playwright + mock fallback + auto-check
│           └── logs/               # Ring-buffer log store (last 500)
├── packages/
│   └── types/                      # Shared TS types: StockAlert, CrawlerLog, etc.
├── turbo.json
├── pnpm-workspace.yaml
└── package.json
```

## Setup

```bash
# 1. Install
pnpm install

# 2. Install Playwright's browser binary (one-time)
pnpm --filter @tradeping/api exec playwright install chromium

# 3. Copy env files
cp apps/web/.env.example apps/web/.env.local
cp apps/api/.env.example apps/api/.env

# 4. Run everything (Turbo will build packages/types first, then run web + api)
pnpm dev
```

Then open http://localhost:3000.

## Root scripts

| Command          | Description                          |
|------------------|--------------------------------------|
| `pnpm dev`       | Run web + api in parallel (hot reload) |
| `pnpm build`     | Build both apps                      |
| `pnpm lint`      | Lint everything                      |
| `pnpm format`    | Prettier write                       |

## API endpoints

Base URL: `http://localhost:4000`

| Method | Path                | Body / Notes                                                    |
|--------|---------------------|-----------------------------------------------------------------|
| GET    | `/health`           | `{ status: 'ok', service: 'TradePing API' }`                    |
| GET    | `/stocks`           | List of supported NEPSE symbols                                 |
| GET    | `/alerts`           | List all alerts                                                 |
| POST   | `/alerts`           | `{ symbol, targetPrice, condition: ABOVE \| BELOW \| EQUAL }`   |
| DELETE | `/alerts/:id`       | Remove an alert                                                 |
| GET    | `/logs`             | Crawler + alert logs (newest first, capped at 500)              |
| GET    | `/crawler/status`   | `{ lastCheckAt, lastCheckOk }`                                  |
| POST   | `/crawler/check`    | Force a manual crawler pass                                     |

## Environment variables

### `apps/api/.env`

| Variable                   | Default                                       | Purpose                            |
|----------------------------|-----------------------------------------------|------------------------------------|
| `PORT`                     | `4000`                                        | API port                           |
| `FRONTEND_URL`             | `http://localhost:3000`                       | CORS allowed origin                |
| `GOOGLE_CLIENT_ID`         |                                               | Google OAuth web client ID used to verify sign-in |
| `AUTH_SESSION_SECRET`      |                                               | Secret used to sign TradePing session tokens |
| `AUTH_SESSION_DAYS`        | `7`                                           | Session lifetime after Google sign-in |
| `GOOGLE_ALLOWED_EMAILS`    |                                               | Optional comma-separated allowlist |
| `GOOGLE_ALLOWED_DOMAINS`   |                                               | Optional comma-separated domain allowlist |
| `NEPSE_SOURCE_URL`         | `https://www.nepsealpha.com/trading/chart`    | Page Playwright crawls             |
| `CRAWLER_INTERVAL_SECONDS` | `30`                                          | Auto-check interval                |

### `apps/web/.env.local`

| Variable               | Default                   |
|------------------------|---------------------------|
| `NEXT_PUBLIC_API_URL`  | `http://localhost:4000`   |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` |                    |

For Google OAuth, use the same Google OAuth web client ID for `GOOGLE_CLIENT_ID` and
`NEXT_PUBLIC_GOOGLE_CLIENT_ID`. After changing any `NEXT_PUBLIC_*` value, rebuild or
restart the web app so Next.js can inline the public env value.

## How the crawler works

1. On startup, `CrawlerService` boots a headless Chromium browser via Playwright.
2. A `setInterval` runs every `CRAWLER_INTERVAL_SECONDS` and iterates over every **active** alert.
3. For each alert, the crawler:
   - Opens `NEPSE_SOURCE_URL` in a new browser context.
   - Tries to extract a price from the page text.
   - If extraction fails (selector mismatch, timeout, page change, network error) it **does not crash** — it logs a warning and falls back to a mock price.
4. Each price is compared to the alert's target. Matching alerts get marked `TRIGGERED` and a `Target reached for SYMBOL` log entry is written.
5. Both manual (`POST /crawler/check`) and auto runs follow the same pipeline.

## Mock fallback

NepseAlpha's chart page is a heavy SPA whose markup is volatile, so the crawler is **defensive by design**. When the live extraction can't return a valid number, `mockPrice(symbol)` returns a uniformly distributed random value inside a per-symbol realistic range:

| Symbol | Range (Rs.) |
|--------|-------------|
| NABIL  | 500 – 700   |
| NICA   | 300 – 600   |
| HDL    | 1000 – 2500 |
| API    | 150 – 350   |
| SHIVM  | 400 – 800   |
| NIFRA  | 180 – 350   |
| GBIME  | 180 – 350   |
| SANIMA | 200 – 400   |
| NRIC   | 500 – 900   |
| CIT    | 1500 – 2500 |

Mock vs. live source is recorded on every `CrawlerResult`, so the UI/logs make it clear which mode produced a price.

## Limitations

- **In-memory only** — alerts and logs vanish when the API restarts.
- **Crawler selectors are best-effort** — without a stable public API or known DOM selector for NepseAlpha's chart, live extraction often falls back to mock data.
- Authentication is Google-only; user-owned alerts, watchlists, notification channels, templates, and rules are scoped by the signed-in user.
- Logs are capped at 500 entries (ring buffer).

## Future improvements

- Persist alerts and logs to a database (Postgres + Prisma).
- Authentication and per-user portfolios.
- Email / SMS / push notifications when alerts trigger.
- Better, stable crawler selectors (or an official NEPSE feed if one becomes available).
- Alert history with charts.
- Multiple alert conditions per stock (e.g. range alerts).
- WebSocket push to the frontend instead of polling.
# TradePing
