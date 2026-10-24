import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { count, eq } from "drizzle-orm";
import { Toaster } from "@/components/toaster";
import { db, invoices } from "@/db";
import { AppSidebar } from "@/components/app-sidebar";
import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { isAIConfigured, MODEL } from "@/lib/agent/openai";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "ProcureMind", template: "%s · ProcureMind" },
  description: "AI-assisted invoice authentication for procurement teams.",
};

// Every page reads live data from Postgres.
export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const [{ value: reviewCount }] = await db
    .select({ value: count() })
    .from(invoices)
    .where(eq(invoices.status, "flagged"));

  return (
    <html lang="en" suppressHydrationWarning className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
      <body className="min-h-dvh">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <TooltipProvider delayDuration={150}>
            <div className="flex min-h-dvh flex-col lg:flex-row">
              <AppSidebar reviewCount={reviewCount} aiReady={isAIConfigured()} model={MODEL} />
              <main className="min-w-0 flex-1">
                <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-10 lg:py-9">{children}</div>
              </main>
            </div>
          </TooltipProvider>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
