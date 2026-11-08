import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Markdown } from "@/components/docs/markdown";
import { REPO_DOCS } from "@/components/docs/nav";

/** docs/*.md at the repository root; next.config traces these files into the server bundle. */
const DOCS_DIR = path.join(process.cwd(), "..", "..", "docs");

export function generateStaticParams() {
  return Object.keys(REPO_DOCS).map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: PageProps<"/docs/[slug]">): Promise<Metadata> {
  const doc = REPO_DOCS[(await params).slug];
  return doc ? { title: doc.title, description: doc.description } : {};
}

export default async function RepoDocPage({ params }: PageProps<"/docs/[slug]">) {
  const doc = REPO_DOCS[(await params).slug];
  if (!doc) notFound();
  const source = await readFile(path.join(DOCS_DIR, doc.file), "utf8").catch(() => null);
  if (source == null) notFound();
  return <Markdown source={source} />;
}
