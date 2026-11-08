export const DOCS_NAV = [
  { href: "/docs", label: "How it works" },
  { href: "/docs/scoring", label: "Scoring" },
  { href: "/docs/guards", label: "Guards" },
  { href: "/docs/ai-tuner", label: "AI Risk Tuner" },
  { href: "/docs/run-your-own-agent", label: "Run your own agent" },
  { href: "/docs/api", label: "API and MCP reference" },
  { href: "/docs/contracts", label: "Contracts" },
  { href: "/docs/architecture", label: "Architecture" },
] as const;

/** Docs rendered straight from the repository so the site and the repo never drift. */
export const REPO_DOCS: Record<string, { file: string; title: string; description: string }> = {
  scoring: { file: "SCORING.md", title: "Scoring", description: "How STRATA measures liquidity and turns it into a verifiable score." },
  guards: { file: "GUARDS.md", title: "Guards", description: "Oracle, session and risk guards that stop agents quoting into bad data." },
  "ai-tuner": { file: "AI_TUNER.md", title: "AI Risk Tuner", description: "The bounded AI that suggests parameter changes and never trades." },
  architecture: { file: "ARCHITECTURE.md", title: "Architecture", description: "How the agents, indexer, scorer, API and contracts fit together." },
};
