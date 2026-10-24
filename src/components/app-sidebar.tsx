"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Building2Icon,
  ClipboardListIcon,
  FileTextIcon,
  LayoutDashboardIcon,
  MenuIcon,
  PackageIcon,
  ShieldCheckIcon,
  UploadIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboardIcon },
  { href: "/upload", label: "Upload & verify", icon: UploadIcon },
  { href: "/invoices", label: "Invoices", icon: FileTextIcon },
  { href: "/inventory", label: "Inventory", icon: PackageIcon },
  { href: "/vendors", label: "Vendors", icon: Building2Icon },
  { href: "/purchase-orders", label: "Purchase orders", icon: ClipboardListIcon },
] as const;

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2.5">
      <span className="bg-brand flex size-8 items-center justify-center rounded-lg text-white shadow-sm">
        <ShieldCheckIcon className="size-[18px]" />
      </span>
      <span className="leading-tight">
        <span className="block text-[15px] font-semibold tracking-tight">ProcureMind</span>
        {/* <span className="text-muted-foreground block text-[11px]">Procurement AP</span> */}
      </span>
    </Link>
  );
}

export function AppSidebar({ reviewCount, aiReady, model }: { reviewCount: number; aiReady: boolean; model: string }) {
  const pathname = usePathname();

  return (
    <>
      <aside className="bg-sidebar sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r px-3 py-5 lg:flex">
        <div className="px-2">
          <Brand />
        </div>
        <nav className="mt-8 flex flex-col gap-0.5">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = isActive(pathname, href);
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "group text-muted-foreground hover:bg-accent hover:text-foreground flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors",
                  active && "bg-card text-foreground ring-border shadow-xs ring-1",
                )}
              >
                <Icon className={cn("size-4", active && "text-brand")} />
                {label}
                {href === "/invoices" && reviewCount > 0 && (
                  <span className="bg-warning/15 text-warning-ink ml-auto rounded-full px-1.5 text-[11px] font-semibold tabular-nums">
                    {reviewCount}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
        <div className="bg-card mt-auto flex items-center justify-between gap-2 rounded-lg border px-3 py-2.5">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-xs font-medium">
              <span className={cn("size-1.5 rounded-full", aiReady ? "bg-good" : "bg-critical")} />
              {aiReady ? "Agent online" : "Agent offline"}
            </div>
            <div className="text-muted-foreground truncate font-mono text-[11px]">
              {aiReady ? model : "Set OPENAI_API_KEY"}
            </div>
          </div>
          <ThemeToggle />
        </div>
      </aside>

      <header className="bg-background/85 sticky top-0 z-40 flex h-14 items-center justify-between border-b px-4 backdrop-blur lg:hidden">
        <Brand />
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Open navigation">
                <MenuIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              {NAV.map(({ href, label, icon: Icon }) => (
                <DropdownMenuItem key={href} asChild>
                  <Link href={href}>
                    <Icon />
                    {label}
                  </Link>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
    </>
  );
}
