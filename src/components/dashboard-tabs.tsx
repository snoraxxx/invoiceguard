"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function DashboardTabs({
  counts,
  verified,
  flagged,
  rejected,
}: {
  counts: { verified: number; flagged: number; rejected: number };
  verified: React.ReactNode;
  flagged: React.ReactNode;
  rejected: React.ReactNode;
}) {
  const tabs = [
    { value: "verified", label: "Verified", count: counts.verified, content: verified },
    { value: "flagged", label: "Needs review", count: counts.flagged, content: flagged },
    { value: "rejected", label: "Rejected", count: counts.rejected, content: rejected },
  ];
  return (
    <Tabs defaultValue="verified" className="gap-0">
      <div className="border-b px-5 pb-3">
        <TabsList>
          {tabs.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>
              {t.label}
              <span className="bg-muted text-muted-foreground rounded-full px-1.5 text-[11px] tabular-nums">
                {t.count}
              </span>
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      {tabs.map((t) => (
        <TabsContent key={t.value} value={t.value}>
          {t.content}
        </TabsContent>
      ))}
    </Tabs>
  );
}
