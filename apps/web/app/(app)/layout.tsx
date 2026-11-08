import { displayFont } from "@strata/ui/fonts";
import { DevDataNotice } from "@/components/data/dev-data-notice";
import { SiteFooter } from "@/components/site/footer";
import { SiteHeader } from "@/components/site/header";

/**
 * Data pages sit on survey paper: a hairline grid that fades toward the edges, with fine grain.
 * Bricolage (display) is loaded here too: page titles use it at h1 size.
 */
export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <div className={`${displayFont.variable} relative`}>
      <div aria-hidden className="app-ground survey-grid grain" />
      <SiteHeader />
      <DevDataNotice />
      <main id="main" className="relative mx-auto min-h-dvh w-full max-w-[1320px] px-4 pb-8 pt-10 sm:px-6 sm:pt-14 lg:px-12">
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
