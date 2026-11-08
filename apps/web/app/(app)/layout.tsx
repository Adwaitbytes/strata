import { SiteFooter } from "@/components/site/footer";
import { SiteHeader } from "@/components/site/header";
import { DevDataNotice } from "@/components/data/dev-data-notice";

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <SiteHeader />
      <DevDataNotice />
      <main id="main" className="mx-auto min-h-dvh w-full max-w-[1280px] px-4 pb-8 pt-8 sm:px-6 sm:pt-10">
        {children}
      </main>
      <SiteFooter />
    </>
  );
}
