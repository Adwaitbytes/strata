/** Admin routes. Each call is authorized by an owner signature, never by a bearer secret. */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { KillRequest, NetworkName, TimestampMs } from "@strata/sdk";
import type { ApiConfig } from "../config.js";
import { parseInput, validated } from "../errors.js";
import type { Repository } from "../repo/types.js";
import { acceptKill } from "../admin/kill.js";

export const KillAccepted = z.object({
  accepted: z.literal(true),
  id: z.string().uuid(),
  network: NetworkName,
  target: z.union([z.literal("all"), z.number().int().positive()]),
  closePositions: z.boolean(),
  requestedAt: TimestampMs,
});

export async function registerAdminRoutes(
  app: FastifyInstance,
  deps: { config: ApiConfig; repo: Repository; now: () => number },
): Promise<void> {
  app.post(
    "/v1/admin/kill",
    { config: { rateLimit: { max: 10, timeWindow: 60_000 } } },
    async (req, reply) => {
      const body = parseInput(KillRequest, req.body, "body");
      const cmd = await acceptKill({ repo: deps.repo, owner: deps.config.ownerAddress, now: deps.now }, body);
      req.log.warn({ killCommandId: cmd.id, network: cmd.network, target: body.target }, "kill command accepted");
      void reply.status(202).header("cache-control", "no-store");
      return validated(KillAccepted, {
        accepted: true,
        id: cmd.id,
        network: cmd.network,
        target: body.target,
        closePositions: cmd.closePositions,
        requestedAt: cmd.requestedAt,
      });
    },
  );
}
