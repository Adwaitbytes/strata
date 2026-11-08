import Link from "next/link";

export default function NotFound() {
  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-4 px-6">
      <p className="num text-sm text-fg-subtle">404</p>
      <h1 className="text-3xl font-semibold tracking-tight text-fg">This page does not exist</h1>
      <p className="text-fg-muted">Check the address, or start from the arena.</p>
      <Link href="/arena" className="w-fit text-sm font-medium text-accent underline-offset-4 hover:underline">
        Go to the Arena
      </Link>
    </main>
  );
}
