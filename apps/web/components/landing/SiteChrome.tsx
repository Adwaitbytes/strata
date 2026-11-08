/** Ecosystem line under the story. Accurate only: built on Injective, no implied partnership. */
export function EcosystemStrip() {
  return (
    <section aria-label="Ecosystem" className="ecosystem">
      <div className="site-container flex flex-wrap items-center justify-between gap-4 py-8">
        <p className="text-sm text-fg-muted">
          Built on{" "}
          <a href="https://injective.com" className="text-fg underline decoration-border-strong underline-offset-4 hover:decoration-fg" rel="noopener noreferrer">
            Injective
          </a>
          . Fully onchain order books, native oracles, EVM contracts.
        </p>
        <p className="text-micro text-fg-subtle">Independent project. Not affiliated with or endorsed by Injective.</p>
      </div>
    </section>
  );
}
