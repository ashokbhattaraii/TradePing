'use client';

import { motion } from 'framer-motion';
import { Wifi, Bell, Clock, ScrollText } from 'lucide-react';
import { Card } from './ui/card';
import { formatRelative } from '@/lib/utils';

interface StatusCardsProps {
  apiOnline: boolean;
  activeAlerts: number;
  lastCheckAt: string | null;
  totalLogs: number;
}

const items = (props: StatusCardsProps) => [
  {
    label: 'Backend',
    value: props.apiOnline ? 'Connected' : 'Offline',
    sub: props.apiOnline ? 'API responding' : 'No connection',
    icon: Wifi,
    accent: props.apiOnline ? 'text-emerald-400' : 'text-red-400',
  },
  {
    label: 'Active alerts',
    value: String(props.activeAlerts),
    sub: 'currently watching',
    icon: Bell,
    accent: 'text-blue-400',
  },
  {
    label: 'Last check',
    value: formatRelative(props.lastCheckAt),
    sub: props.lastCheckAt ? new Date(props.lastCheckAt).toLocaleTimeString() : 'No checks yet',
    icon: Clock,
    accent: 'text-amber-400',
  },
  {
    label: 'Total logs',
    value: String(props.totalLogs),
    sub: 'crawler events',
    icon: ScrollText,
    accent: 'text-purple-400',
  },
];

export function StatusCards(props: StatusCardsProps) {
  return (
    <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {items(props).map((item, i) => (
        <motion.div
          key={item.label}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: i * 0.05 }}
        >
          <Card className="p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-wider text-white/50">{item.label}</span>
              <item.icon className={`h-4 w-4 ${item.accent}`} />
            </div>
            <div className="mt-3 truncate text-2xl font-semibold text-white">{item.value}</div>
            <div className="mt-1 truncate text-xs text-white/40">{item.sub}</div>
          </Card>
        </motion.div>
      ))}
    </section>
  );
}
