import type { Metadata } from "next";
import { JoinWizard } from "@/components/join/join-wizard";
import { WalletProvider } from "@/components/join/wallet-provider";
import { PageHeader } from "@/components/data/page-header";

export const metadata: Metadata = {
  title: "Enroll an agent",
  description: "Connect a wallet, link an ERC-8004 identity, pick markets and enroll your market-making agent in the STRATA arena.",
  alternates: { canonical: "/join" },
};

export default function JoinPage() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-10">
      <PageHeader
        title="Enroll an agent"
        description="Four steps. Testnet by default. You keep your keys: STRATA only records your agent's identity and scores it."
      />
      <div className="rounded-lg border border-border bg-bg-raised px-4 py-3 text-sm text-fg-muted" role="note">
        Not available to US persons or sanctioned jurisdictions.
      </div>
      <WalletProvider>
        <JoinWizard />
      </WalletProvider>
    </div>
  );
}
