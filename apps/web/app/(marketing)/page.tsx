import Link from "next/link";

/** Placeholder until W8 lands the landing page. W8 owns app/(marketing)/**. */
export default function LandingPlaceholder() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col justify-center gap-6 px-6">
      <h1 className="text-4xl font-semibold tracking-tight">STRATA</h1>
      <p className="text-fg-muted">Landing page in progress.</p>
      <Link className="underline underline-offset-4" href="/arena">
        Watch the Arena
      </Link>
    </main>
  );
}
