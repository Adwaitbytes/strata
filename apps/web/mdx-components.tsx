import type { MDXComponents } from "mdx/types";
import { docsComponents } from "@/components/docs/elements";

export function useMDXComponents(components: MDXComponents = {}): MDXComponents {
  return { ...docsComponents, ...components };
}
