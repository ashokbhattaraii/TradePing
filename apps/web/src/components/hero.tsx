'use client';

import { motion } from 'framer-motion';
import { Activity } from 'lucide-react';
import { Badge } from './ui/badge';

export function Hero({ apiOnline }: { apiOnline: boolean }) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: 'easeOut' }}
      className="relative pb-12 pt-20 text-center"
    >
      <div className="mb-5 flex justify-center">
        <Badge tone={apiOnline ? 'success' : 'danger'} dot>
          {apiOnline ? 'System operational' : 'API offline'}
        </Badge>
      </div>
      <h1 className="bg-gradient-to-b from-white to-white/60 bg-clip-text text-5xl font-bold tracking-tight text-transparent sm:text-6xl">
        TradePing
      </h1>
      <p className="mx-auto mt-4 flex max-w-xl items-center justify-center gap-2 text-base text-white/60 sm:text-lg">
        <Activity className="h-4 w-4 text-blue-400" />
        Real-time NEPSE stock price alerts powered by an automated crawler
      </p>
    </motion.section>
  );
}
