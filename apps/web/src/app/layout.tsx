import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';

const sans = Inter({ subsets: ['latin'], variable: '--font-geist-sans' });
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-geist-mono' });

export const metadata: Metadata = {
  title: 'TradePing — NEPSE Stock Alerts',
  description: 'Real-time NEPSE stock price alerts powered by an automated crawler.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body className="bg-grid relative min-h-screen overflow-x-hidden antialiased">
        <div className="relative z-10">{children}</div>
      </body>
    </html>
  );
}
