import { DocsSidebar } from "@/components/docs/sidebar";

export default function DocsLayout({ children }: LayoutProps<"/docs">) {
  return (
    <div className="grid gap-8 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-14">
      <aside>
        <DocsSidebar />
      </aside>
      <article className="min-w-0 max-w-[72ch]">{children}</article>
    </div>
  );
}
