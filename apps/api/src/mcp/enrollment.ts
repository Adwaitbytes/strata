/**
 * Unsigned enrollment transaction for StrataArena.enroll (PRD 8.1, 13). STRATA never signs
 * and never holds the operator's key: the caller signs and broadcasts this themselves.
 */
import { encodeFunctionData } from "viem";
import { NETWORKS } from "@strata/config";
import { strataArenaAbi, type NetworkName } from "@strata/sdk";

export interface EnrollmentArgs {
  erc8004Id: string;
  subaccountId: string;
  metadataURI: string;
}

export interface UnsignedEnrollmentTx {
  chainId: number;
  to: `0x${string}`;
  data: `0x${string}`;
  value: "0";
  /** Injective EVM expects legacy (type 0) transactions (PRD 4.4). */
  type: "legacy";
  gasPrice: string;
  note: string;
}

export function prepareEnrollment(network: NetworkName, arena: `0x${string}`, args: EnrollmentArgs): UnsignedEnrollmentTx {
  const net = NETWORKS[network];
  return {
    chainId: net.evm.chainId,
    to: arena,
    data: encodeFunctionData({
      abi: strataArenaAbi,
      functionName: "enroll",
      args: [BigInt(args.erc8004Id), args.subaccountId as `0x${string}`, args.metadataURI],
    }),
    value: "0",
    type: "legacy",
    gasPrice: net.gasPriceWei.toString(),
    note: "Unsigned. Sign with the operator wallet that owns the ERC-8004 identity, then broadcast. Estimate gas before sending.",
  };
}
