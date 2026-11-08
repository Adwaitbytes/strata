import { DEFAULT_ANTI_GAMING_PARAMS, type AntiGamingParams } from "./antiGaming.js";
import { DEFAULT_SCORE_PARAMS, type ScoreParams } from "./score.js";

/** Every tunable that changes a published score. Published values live in docs/SCORING.md. */
export interface ScoringParams {
  score: ScoreParams;
  antiGaming: AntiGamingParams;
}

export const DEFAULT_PARAMS: ScoringParams = {
  score: DEFAULT_SCORE_PARAMS,
  antiGaming: DEFAULT_ANTI_GAMING_PARAMS,
};
