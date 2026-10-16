import Link from "next/link";

export default function DbUnavailablePage() {
  return (
    <main className="auth-page">
      <div className="auth-card" style={{ maxWidth: 520 }}>
        <h1>Database not running</h1>
        <p className="hint" style={{ marginBottom: 16 }}>
          LedgerDesk could not connect to Postgres at <strong>localhost:5434</strong>. The app
          needs Docker Postgres for local development.
        </p>
        <ol style={{ margin: "0 0 20px", paddingLeft: 20, lineHeight: 1.6 }}>
          <li>Open <strong>Docker Desktop</strong> and wait until it shows “Running”.</li>
          <li>
            In the project folder, run: <code>npm run db:up</code>
          </li>
          <li>
            Optional check: <code>npm run db:status</code>
          </li>
          <li>Restart the dev server if it was already running: <code>npm run dev</code></li>
        </ol>
        <p className="hint" style={{ marginBottom: 16 }}>
          Your <code>DATABASE_URL</code> in <code>.env</code> should match{" "}
          <code>postgresql://ledgerdesk:ledgerdesk@localhost:5434/ledgerdesk</code>.
        </p>
        <Link href="/db-unavailable" className="btn-converter btn-primary">
          Retry
        </Link>
      </div>
    </main>
  );
}
