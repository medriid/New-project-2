import { agentStream } from "@/lib/agent";
import { requireSignedIn } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { response } = await requireSignedIn();
  if (response) {
    return response;
  }

  const { id } = await context.params;
  const stream = await agentStream(`/servers/${encodeURIComponent(id)}/logs/stream`);

  return new Response(stream.body, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
    },
  });
}
