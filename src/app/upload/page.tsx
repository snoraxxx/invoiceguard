import type { Metadata } from "next";
import {
  Building2Icon,
  CalculatorIcon,
  CopyIcon,
  FileSearchIcon,
  LandmarkIcon,
  ReceiptTextIcon,
  SparklesIcon,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Uploader } from "@/components/uploader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { isAIConfigured, MODEL } from "@/lib/agent/openai";

export const metadata: Metadata = { title: "Upload & verify" };

const CHECKS = [
  {
    icon: FileSearchIcon,
    title: "Reads the document",
    text: "Extracts vendor, amounts, bank details and line items, and looks for signs of tampering.",
  },
  {
    icon: Building2Icon,
    title: "Vendor & tax ID",
    text: "Must match an approved vendor. Look-alike names are called out.",
  },
  {
    icon: LandmarkIcon,
    title: "Bank details",
    text: "Payment account must match the one on file — the #1 fraud pattern.",
  },
  { icon: CopyIcon, title: "Duplicates", text: "Same file, same invoice number or same amount and date." },
  { icon: CalculatorIcon, title: "Arithmetic", text: "Line items, tax and totals must reconcile." },
  {
    icon: ReceiptTextIcon,
    title: "Purchase order",
    text: "PO must exist, belong to the vendor and have enough balance.",
  },
  { icon: SparklesIcon, title: "Agent review", text: "Investigates vendor history and gives a verdict with reasons." },
];

export default function UploadPage() {
  const aiReady = isAIConfigured();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Upload & verify"
        description="Drop invoices in and the agent will authenticate each one. It takes about 20–40 seconds per invoice."
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Uploader aiReady={aiReady} />
        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="text-sm">What gets checked</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-4">
              {CHECKS.map(({ icon: Icon, title, text }) => (
                <li key={title} className="flex gap-3">
                  <span className="bg-muted flex size-7 shrink-0 items-center justify-center rounded-md">
                    <Icon className="text-muted-foreground size-3.5" />
                  </span>
                  <div>
                    <div className="text-sm font-medium">{title}</div>
                    <div className="text-muted-foreground text-xs leading-relaxed">{text}</div>
                  </div>
                </li>
              ))}
            </ul>
            <div className="bg-muted text-muted-foreground mt-5 rounded-md px-3 py-2 font-mono text-[11px]">
              model: {MODEL}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
