import { DataBadge } from "@strata/ui/data";
import { DATA_MODE } from "@/lib/env";

/** Visible on every page while mock data is in use. Mock mode cannot exist in production builds. */
export function DevDataNotice() {
  if (DATA_MODE !== "mock") return null;
  return (
    <div className="border-b border-halt/30 bg-halt-soft" data-testid="mock-notice">
      <div className="mx-auto flex max-w-[1280px] items-center gap-3 px-4 py-2 text-[13px] text-fg sm:px-6">
        <DataBadge tone="halt">MOCK</DataBadge>
        <span className="text-fg-muted">Development data. No STRATA API is configured, so every number on this page is synthetic.</span>
      </div>
    </div>
  );
}
