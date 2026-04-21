export default function SetupSuccessPage() {
  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="text-center max-w-md">
        <h1 className="text-5xl mb-4">Thank you</h1>
        <p className="text-charcoal-muted mb-2">
          Your bank account has been submitted to Flowe Collective.
        </p>
        <p className="text-sm text-charcoal-muted">
          If instant verification was available, you're fully set up. If microdeposits were
          required, you'll see two small deposits in your account within 1–2 business days —
          Stripe will email you with a link to verify the amounts.
        </p>
        <p className="text-xs tracking-[0.2em] uppercase text-charcoal-muted mt-10">
          You can close this window.
        </p>
      </div>
    </div>
  );
}
