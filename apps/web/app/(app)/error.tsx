"use client";

import { ErrorState } from "@/components/data/states";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorState error={error} onRetry={reset} />;
}
