import type { StockAlert } from '@tradeping/types';

export interface TemplateContext {
  alert?: StockAlert;
  price?: number;
  event: string;
  timestamp: string;
  [key: string]: unknown;
}

/**
 * Mustache-lite engine. Supports:
 *   {{var}}            — value substitution
 *   {{#var}}...{{/var}} — block shown only when var is truthy/non-empty
 *   {{nested.path}}    — dot-path access
 */
export function render(template: string, ctx: TemplateContext): string {
  const flat = flatten(ctx);

  // Process block sections first (handle nested by repeated passes).
  let out = template;
  let prev = '';
  while (out !== prev) {
    prev = out;
    out = out.replace(/\{\{#([\w.]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_m, key: string, body: string) => {
      const val = flat[key];
      const truthy = Array.isArray(val) ? val.length > 0 : Boolean(val);
      return truthy ? body : '';
    });
  }

  // Variable substitution.
  out = out.replace(/\{\{([\w.]+)\}\}/g, (_m, key: string) => {
    const val = flat[key];
    if (val === undefined || val === null) return '';
    return String(val);
  });

  return out;
}

function flatten(obj: Record<string, unknown>, prefix = '', acc: Record<string, unknown> = {}): Record<string, unknown> {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) {
      flatten(v as Record<string, unknown>, key, acc);
    } else {
      acc[key] = v;
    }
  }
  return acc;
}

export const DEFAULT_TEMPLATES: Record<string, string> = {
  'alert.triggered': '🔔 *{{alert.symbol}}* hit target — {{alert.condition}} Rs.{{alert.targetPrice}} · now Rs.{{price}}{{#alert.note}} ({{alert.note}}){{/alert.note}}',
  'alert.created': '✅ New alert: {{alert.symbol}} {{alert.condition}} Rs.{{alert.targetPrice}}',
  'alert.expired': '⏰ Alert expired: {{alert.symbol}} target Rs.{{alert.targetPrice}} not met.',
  'system.test': '✅ Test message from TradePing — channel is configured correctly.',
};
