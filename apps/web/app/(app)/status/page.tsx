import type { Metadata } from "next";
import { Suspense } from "react";
import { StatusView } from "@/components/status/status-view";

export const metadata: Metadata = {
  title: "Status",
  description: "STRATA service health, data lag and the last epoch posted onchain.",
  alternates: { canonical: "/status" },
};

export default function StatusPage() {
  return (
    <Suspense>
      <StatusView />
    </Suspense>
  );
}
