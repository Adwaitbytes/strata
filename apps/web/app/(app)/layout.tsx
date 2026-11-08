import { displayFont } from "@strata/ui/fonts";
import { DevDataNotice } from "@/components/data/dev-data-notice";
import { SiteFooter } from "@/components/site/footer";
import { SiteHeader } from "@/components/site/header";

/** Archivo (display) is loaded here too: data page titles use it at h1 size only. */
export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <div className={displayFont.variable}>
      <SiteHeader />
      <DevDataNotice />
      <main id="main" className="mx-auto min-h-dvh w-full max-w-[1280px] px-4 pb-8 pt-8 sm:px-6 sm:pt-10">
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
