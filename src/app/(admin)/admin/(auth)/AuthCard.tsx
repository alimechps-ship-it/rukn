export function AuthCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="auth-page">
      <div className="auth-card">
        <img src="/rukn-logo.png" alt="RUKN" width={156} height={166} />
        <h1 style={{ textAlign: "center", marginBottom: 18, fontSize: "1.25rem" }}>{title}</h1>
        {children}
      </div>
    </main>
  );
}
