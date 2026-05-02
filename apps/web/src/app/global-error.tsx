'use client';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: '#0a0a0a', color: '#fff', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ maxWidth: 420, textAlign: 'center' }}>
            <h1 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>Application crashed</h1>
            <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.6)', marginTop: 8 }}>
              {error.message || 'A fatal error occurred.'}
            </p>
            <button
              onClick={reset}
              style={{
                marginTop: 16,
                background: '#fff',
                color: '#000',
                padding: '8px 16px',
                borderRadius: 8,
                border: 0,
                cursor: 'pointer',
                fontSize: 14,
                fontWeight: 500,
              }}
            >
              Reload
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
