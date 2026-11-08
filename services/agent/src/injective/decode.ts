/**
 * Decodes the msg responses of a broadcast tx (TxResponse.data is a TxMsgData, cosmos-sdk >= 0.46
 * puts typed responses in `msg_responses`). Used to read created order hashes and failed cids from
 * `injective.exchange.v2.MsgBatchUpdateOrdersResponse`, directly or wrapped in an authz
 * `cosmos.authz.v1beta1.MsgExecResponse`.
 */
import { TxMsgData } from "@injectivelabs/core-proto-ts-v2/generated/cosmos/base/abci/v1beta1/abci_pb";
import { MsgExecResponse } from "@injectivelabs/core-proto-ts-v2/generated/cosmos/authz/v1beta1/tx_pb";
import { MsgBatchUpdateOrdersResponse } from "@injectivelabs/core-proto-ts-v2/generated/injective/exchange/v2/tx_pb";

export const BATCH_UPDATE_RESPONSE_TYPE = "/injective.exchange.v2.MsgBatchUpdateOrdersResponse";
export const EXEC_RESPONSE_TYPE = "/cosmos.authz.v1beta1.MsgExecResponse";

export interface BatchResponse {
  derivativeOrderHashes: string[];
  createdDerivativeOrdersCids: string[];
  failedDerivativeOrdersCids: string[];
  derivativeCancelSuccess: boolean[];
  derivativeMarketOrderHashes: string[];
}

/** TxResponse.data arrives as hex (gRPC) or base64 (REST); accept both. */
export function dataBytes(data: string | Uint8Array | undefined): Uint8Array | null {
  if (data === undefined || data.length === 0) return null;
  if (data instanceof Uint8Array) return data;
  if (/^(0x)?[0-9a-fA-F]+$/.test(data) && data.replace(/^0x/, "").length % 2 === 0) {
    return Uint8Array.from(Buffer.from(data.replace(/^0x/, ""), "hex"));
  }
  return Uint8Array.from(Buffer.from(data, "base64"));
}

export function decodeBatchResponse(data: string | Uint8Array | undefined): BatchResponse | null {
  const bytes = dataBytes(data);
  if (bytes === null) return null;
  const msgData = TxMsgData.fromBinary(bytes);
  for (const any of msgData.msgResponses) {
    if (any.typeUrl === BATCH_UPDATE_RESPONSE_TYPE) return toBatch(MsgBatchUpdateOrdersResponse.fromBinary(any.value));
    if (any.typeUrl === EXEC_RESPONSE_TYPE) {
      for (const inner of MsgExecResponse.fromBinary(any.value).results) {
        // MsgExec results are the raw inner msg response bytes (no Any wrapper).
        try {
          return toBatch(MsgBatchUpdateOrdersResponse.fromBinary(inner));
        } catch {
          continue;
        }
      }
    }
  }
  return null;
}

function toBatch(r: MsgBatchUpdateOrdersResponse): BatchResponse {
  return {
    derivativeOrderHashes: r.derivativeOrderHashes,
    createdDerivativeOrdersCids: r.createdDerivativeOrdersCids,
    failedDerivativeOrdersCids: r.failedDerivativeOrdersCids,
    derivativeCancelSuccess: r.derivativeCancelSuccess,
    derivativeMarketOrderHashes: r.derivativeMarketOrderHashes,
  };
}
