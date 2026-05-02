'use client';

import { motion } from 'framer-motion';
import { Bell, Globe, Scale, Sparkles } from 'lucide-react';
import { Card } from './ui/card';

const steps = [
  { icon: Bell, title: 'Set alert', body: 'Pick a NEPSE stock, target price, and condition.' },
  { icon: Globe, title: 'Crawler runs', body: 'Backend crawls NepseAlpha every 30 seconds.' },
  { icon: Scale, title: 'Compare price', body: 'Each price is matched against your target.' },
  { icon: Sparkles, title: 'Get notified', body: 'Triggered alerts update instantly in the UI.' },
];

export function HowItWorks() {
  return (
    <section>
      <header className="mb-6 text-center">
        <h2 className="text-2xl font-semibold text-white">How it works</h2>
        <p className="mt-1 text-sm text-white/50">From alert creation to triggered notification.</p>
      </header>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((step, i) => (
          <motion.div
            key={step.title}
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-40px' }}
            transition={{ duration: 0.4, delay: i * 0.07 }}
          >
            <Card className="h-full p-5">
              <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-white/5">
                <step.icon className="h-4 w-4 text-blue-400" />
              </div>
              <div className="mb-1 text-xs font-mono uppercase tracking-wider text-white/40">
                Step {i + 1}
              </div>
              <h3 className="text-sm font-semibold text-white">{step.title}</h3>
              <p className="mt-1 text-sm text-white/50">{step.body}</p>
            </Card>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
