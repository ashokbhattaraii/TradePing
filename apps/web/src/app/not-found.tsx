import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center bg-zinc-950 px-6 text-center text-white">
      <div>
        <p className="font-mono text-sm uppercase tracking-wider text-white/35">404</p>
        <h1 className="mt-3 text-2xl font-semibold">Page not found</h1>
        <p className="mt-2 text-sm text-white/45">The TradePing view you opened is not available.</p>
        <Link
          href="/"
          className="mt-5 inline-flex h-10 items-center justify-center rounded-lg border border-white/10 bg-white/5 px-4 text-sm font-medium text-white/75 transition-colors hover:bg-white/10 hover:text-white"
        >
          Back to dashboard
        </Link>
      </div>
    </main>
  );
}
