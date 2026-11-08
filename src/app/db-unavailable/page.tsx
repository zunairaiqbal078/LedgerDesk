import Link from "next/link";

export default function DbUnavailablePage() {
  return (
    <main className="auth-page">
      <div className="auth-card" style={{ maxWidth: 520 }}>
        <h1>Database not reachable</h1>
        <p className="hint" style={{ marginBottom: 16 }}>
          LedgerDesk could not connect to Postgres. Check your <code>DATABASE_URL</code> in{" "}
          <code>.env</code> and that the database is running.
        </p>
        <p className="hint" style={{ fontWeight: 600, marginBottom: 8 }}>Local (Docker)</p>
        <ol style={{ margin: "0 0 16px", paddingLeft: 20, lineHeight: 1.6 }}>
          <li>Open <strong>Docker Desktop</strong> and wait until it shows “Running”.</li>
          <li>
            In the project folder: <code>pnpm run db:up</code> or <code>npm run db:up</code>
          </li>
          <li>
            Optional: <code>pnpm run db:status</code>
          </li>
        </ol>
        <p className="hint" style={{ fontWeight: 600, marginBottom: 8 }}>Neon / cloud</p>
        <ol style={{ margin: "0 0 16px", paddingLeft: 20, lineHeight: 1.6 }}>
          <li>
            In the <a href="https://console.neon.tech">Neon console</a>, open your project and wake
            the database if it is suspended.
          </li>
          <li>
            Copy a fresh connection string (pooler URL is fine) into <code>DATABASE_URL</code>.
          </li>
          <li>Restart the dev server: <code>pnpm dev</code></li>
        </ol>
        <Link href="/db-unavailable" className="btn-converter btn-primary">
          Retry
        </Link>
      </div>
    </main>
  );
}
