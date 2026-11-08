import { DataUnavailableError } from "../errors.js";
import type { Repository } from "./types.js";

/**
 * Used when DATABASE_URL is not configured: every read reports 503 instead of the API
 * inventing an empty-but-healthy answer.
 */
export function unavailableRepository(): Repository {
  return new Proxy({} as Repository, {
    get: () => async () => {
      throw new DataUnavailableError();
    },
  });
}
