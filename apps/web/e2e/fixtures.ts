import { test as base, expect, type Page } from "@playwright/test";

/** Methods that would ask the user to sign. None may run unless the user clicks a signing button. */
export const SIGNING_METHODS = ["eth_sign", "personal_sign", "eth_signTypedData", "eth_signTypedData_v4", "eth_sendTransaction", "wallet_sendCalls"];

export const TEST_ADDRESS = "0x1234567890abcdef1234567890abcdef12345678";

/**
 * Minimal EIP-1193 wallet injected before any page script. It records every RPC method so
 * tests can assert that nothing asks for a signature on load.
 */
export async function installFakeWallet(page: Page, opts: { chainId?: number } = {}) {
  await page.addInitScript(
    ({ address, chainId }) => {
      const calls: string[] = [];
      let currentChain = chainId;
      const listeners = new Map<string, Set<(arg: unknown) => void>>();
      const emit = (ev: string, arg: unknown) => listeners.get(ev)?.forEach((fn) => fn(arg));
      const provider = {
        isMetaMask: false,
        request: async ({ method, params }: { method: string; params?: unknown[] }) => {
          calls.push(method);
          switch (method) {
            case "eth_requestAccounts":
            case "eth_accounts":
              return [address];
            case "eth_chainId":
              return `0x${currentChain.toString(16)}`;
            case "net_version":
              return String(currentChain);
            case "wallet_switchEthereumChain": {
              const next = Number.parseInt((params?.[0] as { chainId: string }).chainId, 16);
              currentChain = next;
              emit("chainChanged", `0x${next.toString(16)}`);
              return null;
            }
            case "wallet_requestPermissions":
            case "wallet_getPermissions":
              return [{ parentCapability: "eth_accounts" }];
            default:
              throw Object.assign(new Error(`Unsupported in test wallet: ${method}`), { code: 4200 });
          }
        },
        on: (ev: string, fn: (arg: unknown) => void) => {
          if (!listeners.has(ev)) listeners.set(ev, new Set());
          listeners.get(ev)!.add(fn);
        },
        removeListener: (ev: string, fn: (arg: unknown) => void) => listeners.get(ev)?.delete(fn),
      };
      Object.defineProperty(window, "ethereum", { value: provider, configurable: true });
      Object.defineProperty(window, "__walletCalls", { value: calls });
    },
    { address: TEST_ADDRESS, chainId: opts.chainId ?? 1 },
  );
}

export async function walletCalls(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __walletCalls: string[] }).__walletCalls ?? []);
}

export const test = base;
export { expect };
