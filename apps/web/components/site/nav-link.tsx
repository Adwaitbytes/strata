"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export function NavLink({ href, children }: { href: string; children: string }) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link href={href} aria-current={active ? "page" : undefined} className={cn("nav-link", active && "nav-link-active")}>
      {children}
    </Link>
  );
}
