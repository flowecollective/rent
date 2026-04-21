export default function SetupCancelPage() {
  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="text-center max-w-md">
        <h1 className="text-5xl mb-4">Setup cancelled</h1>
        <p className="text-charcoal-muted mb-2">
          No worries — your bank wasn't connected.
        </p>
        <p className="text-sm text-charcoal-muted">
          If this was a mistake, reach out to Flowe and we'll resend the setup link.
        </p>
      </div>
    </div>
  );
}
