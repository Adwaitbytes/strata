/**
 * Scoped trading grants (PRD 16.1): the owner key (granter) authorizes an agent hot key (grantee)
 * to send `MsgBatchUpdateOrders` for ONE subaccount and a fixed list of derivative markets. No
 * send, withdraw or transfer message is ever granted, so a leaked hot key cannot move funds out.
 *
 * Facts:
 *  - Injective exchange v2 defines typed authorizations, including
 *    `injective.exchange.v2.BatchUpdateOrdersAuthz { subaccount_id, spot_markets, derivative_markets }`
 *    (proto in @injectivelabs/core-proto-ts-v2 generated/injective/exchange/v2/authz_pb, amino name
 *    "exchange/BatchUpdateOrdersAuthz").
 *  - Grants are created with cosmos authz `MsgGrant` and executed with `MsgExec`
 *    (docs.injective.network/developers-native/examples/authz).
 *  - Never grant MsgSend, MsgWithdraw or transfer types (injective-trading-autosign skill).
 */
import { BatchUpdateOrdersAuthz } from "@injectivelabs/core-proto-ts-v2/generated/injective/exchange/v2/authz_pb";
import { MsgGrant, MsgRevoke } from "@injectivelabs/sdk-ts";
import { injToEvmAddress } from "@strata/keys";

export const BATCH_UPDATE_ORDERS_AUTHZ_TYPE = "/injective.exchange.v2.BatchUpdateOrdersAuthz";
export const BATCH_UPDATE_ORDERS_MSG_TYPE = "/injective.exchange.v2.MsgBatchUpdateOrders";

/** Message types that must never be granted to an agent hot key. */
export const FORBIDDEN_GRANT_TYPES: readonly string[] = [
  "/cosmos.bank.v1beta1.MsgSend",
  "/cosmos.bank.v1beta1.MsgMultiSend",
  "/injective.exchange.v1beta1.MsgWithdraw",
  "/injective.exchange.v2.MsgWithdraw",
  "/injective.exchange.v1beta1.MsgExternalTransfer",
  "/injective.exchange.v2.MsgExternalTransfer",
  "/injective.exchange.v2.MsgSubaccountTransfer",
  "/cosmos.authz.v1beta1.MsgGrant",
];

export interface TradingGrant {
  granter: string;
  grantee: string;
  subaccountId: string;
  derivativeMarketIds: readonly string[];
  /** Seconds until expiry. Default 7 days. */
  expirySeconds?: number;
}

export function encodeBatchUpdateOrdersAuthz(subaccountId: string, derivativeMarketIds: readonly string[]): { typeUrl: string; value: Uint8Array } {
  if (!/^0x[0-9a-fA-F]{64}$/.test(subaccountId)) throw new Error(`invalid subaccount id ${subaccountId}`);
  if (derivativeMarketIds.length === 0) throw new Error("at least one derivative market is required");
  for (const id of derivativeMarketIds) if (!/^0x[0-9a-fA-F]{64}$/.test(id)) throw new Error(`invalid market id ${id}`);
  const value = BatchUpdateOrdersAuthz.toBinary({ subaccountId, spotMarkets: [], derivativeMarkets: [...derivativeMarketIds] });
  return { typeUrl: BATCH_UPDATE_ORDERS_AUTHZ_TYPE, value };
}

export function buildTradingGrant(g: TradingGrant): MsgGrant {
  if (g.granter === g.grantee) throw new Error("granter and grantee must differ");
  // A subaccount id is the owner's 20-byte address followed by a 12-byte index.
  if (g.subaccountId.slice(0, 42).toLowerCase() !== injToEvmAddress(g.granter).toLowerCase()) {
    throw new Error("the granted subaccount must belong to the granter");
  }
  return MsgGrant.fromJSON({
    granter: g.granter,
    grantee: g.grantee,
    authorization: encodeBatchUpdateOrdersAuthz(g.subaccountId, g.derivativeMarketIds),
    expiryInSeconds: g.expirySeconds ?? 7 * 24 * 3600,
  });
}

export function buildTradingRevoke(granter: string, grantee: string): MsgRevoke {
  return MsgRevoke.fromJSON({ granter, grantee, messageType: BATCH_UPDATE_ORDERS_MSG_TYPE });
}
