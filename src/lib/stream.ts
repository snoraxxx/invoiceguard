import type { AnalysisEvent } from "@/lib/types";

type Emit = (event: AnalysisEvent) => void;

/**
 * Streams analysis progress as newline-delimited JSON. If the browser disconnects the work keeps
 * running to completion so the invoice never gets stuck in "processing".
 */
export function ndjsonResponse(run: (emit: Emit) => Promise<void>) {
  const encoder = new TextEncoder();
  let open = true;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit: Emit = (event) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          open = false;
        }
      };
      try {
        await run(emit);
      } catch (error) {
        emit({ type: "error", message: error instanceof Error ? error.message : "Unexpected error" });
      } finally {
        if (open) {
          open = false;
          controller.close();
        }
      }
    },
    cancel() {
      open = false;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
