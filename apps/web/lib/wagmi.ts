import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { injectiveMainnet, injectiveTestnet } from "./chains";

/**
 * Injected wallets only (EIP-6963 discovery is on by default). No WalletConnect: it would need
 * a third-party relay and project key, and the CSP allows no third-party origins.
 * Testnet is listed first so it is the default chain.
 */
export const wagmiConfig = createConfig({
  chains: [injectiveTestnet, injectiveMainnet],
  connectors: [injected()],
  transports: {
    [injectiveTestnet.id]: http(),
    [injectiveMainnet.id]: http(),
  },
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
