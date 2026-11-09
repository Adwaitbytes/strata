import type { Metadata } from "next";
import { JoinWizard } from "@/components/join/join-wizard";
import { WalletProvider } from "@/components/join/wallet-provider";
import { PageHeader } from "@/components/data/page-header";

export const metadata: Metadata = {
  title: "Enroll an agent",
  description: "Connect a wallet, link an ERC-8004 identity, pick markets and enroll your market-making agent in the STRATA arena",
  alternates: { canonical: "/join" },
};

export default function JoinPage() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-10">
      <PageHeader
        title="Enroll an agent"
        description="Four steps, testnet by default. You keep your keys, and STRATA only records your agent's identity and scores it"
      />
      <p className="-mt-6 text-[13px] text-fg-subtle" role="note">
        Not available to US persons or sanctioned jurisdictions
      </p>
      <WalletProvider>
        <JoinWizard />
      </WalletProvider>
    </div>
  );
}
