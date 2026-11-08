// Builds the STRATA deck: inlines the wordmark geometry from packages/ui (single source of the
// brand, D22) into deck.src.html, writes index.html, and prints deliverables/STRATA-deck.pdf with
// headless Chrome. Usage: node deliverables/deck/build.mjs [path-to-chrome]
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");

const geometry = readFileSync(join(root, "packages/ui/src/brand-geometry.ts"), "utf8");
const match = /WORDMARK = \{[\s\S]*?d: "([^"]+)"/.exec(geometry);
if (!match) throw new Error("WORDMARK path not found in packages/ui/src/brand-geometry.ts");

const src = readFileSync(join(here, "deck.src.html"), "utf8");
if (!src.includes("__WORDMARK_D__")) throw new Error("deck.src.html is missing the __WORDMARK_D__ slot");
const html = src.replace("__WORDMARK_D__", match[1]);
if (html.includes("—")) throw new Error("Em dash found in deck copy");
const out = join(here, "index.html");
writeFileSync(out, html);

const chromeCandidates = [
  process.argv[2],
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter((p) => typeof p === "string" && p.length > 0);
const chrome = chromeCandidates.find((p) => existsSync(p));
if (!chrome) throw new Error("Chrome not found. Pass its path as the first argument or set CHROME_PATH.");

const pdf = join(root, "deliverables/STRATA-deck.pdf");
execFileSync(
  chrome,
  [
    "--headless=new",
    "--disable-gpu",
    "--no-pdf-header-footer",
    "--allow-file-access-from-files",
    "--virtual-time-budget=5000",
    `--print-to-pdf=${pdf}`,
    pathToFileURL(out).href,
  ],
  { stdio: ["ignore", "ignore", "pipe"] },
);
if (!existsSync(pdf)) throw new Error("PDF was not written");
process.stdout.write(`Wrote ${pdf}\n`);
