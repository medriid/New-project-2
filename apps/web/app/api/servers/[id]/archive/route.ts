import { agentStream } from "@/lib/agent";
import { requireOwner } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { response } = await requireOwner();
  if (response) {
    return response;
  }

  const { id } = await context.params;
  const archive = await agentStream(`/servers/${encodeURIComponent(id)}/archive`);

  return new Response(archive.body, {
    headers: {
      "Content-Type": archive.headers.get("content-type") ?? "application/zip",
      "Content-Disposition": archive.headers.get("content-disposition") ?? "attachment; filename=\"server.zip\"",
      "Cache-Control": "no-store",
    },
  });
}
