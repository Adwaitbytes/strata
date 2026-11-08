import { displayFont } from "@strata/ui/fonts";
import "@/components/landing/landing.css";

/**
 * Marketing shell. The display face is loaded here rather than in the root layout, so only
 * routes that lead with it pay for (and preload) it.
 */
export default function MarketingLayout({ children }: LayoutProps<"/">) {
  return <div className={`${displayFont.variable} landing`}>{children}</div>;
}
