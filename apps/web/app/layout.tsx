import { BRAND } from "@strata/ui/brand";
import { monoFont, sansFont } from "@strata/ui/fonts";
import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Providers } from "@/components/providers";
import { THEME_BOOT_SCRIPT } from "@/components/theme";
import { SITE_URL } from "@/lib/env";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: `${BRAND.name}: liquidity arena for Injective`, template: `%s | ${BRAND.name}` },
  description: BRAND.subhead,
  applicationName: BRAND.name,
  openGraph: { type: "website", siteName: BRAND.name, title: BRAND.headline, description: BRAND.subhead },
  twitter: { card: "summary_large_image", title: BRAND.headline, description: BRAND.subhead },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#07080b" },
    { media: "(prefers-color-scheme: light)", color: "#f4f6f9" },
  ],
  colorScheme: "dark light",
};

const orgJsonLd = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: BRAND.name,
  url: SITE_URL,
  description: BRAND.subhead,
  parentOrganization: { "@type": "Organization", name: BRAND.studio },
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="en" data-theme="dark" className={`${sansFont.variable} ${monoFont.variable}`} suppressHydrationWarning>
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
        <script
          type="application/ld+json"
          nonce={nonce}
          dangerouslySetInnerHTML={{ __html: JSON.stringify(orgJsonLd).replace(/</g, "\\u003c") }}
        />
      </head>
      <body className="min-h-dvh">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
