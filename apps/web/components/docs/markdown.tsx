import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { docsComponents } from "./elements";

/** Renders repository markdown (docs/*.md). Raw HTML is not enabled, so the source cannot inject markup. */
export function Markdown({ source }: { source: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={docsComponents}>
      {source}
    </ReactMarkdown>
  );
}
