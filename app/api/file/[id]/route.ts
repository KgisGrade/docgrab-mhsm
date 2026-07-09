import type { NextRequest } from "next/server"
import { getPdf } from "@/lib/store"

export const dynamic = "force-dynamic"

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const pdf = await getPdf(id)

  if (!pdf) {
    return Response.json({ error: "File not found or expired" }, { status: 404 })
  }

  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${id}.pdf"`,
      "Content-Length": String(pdf.length),
      "Cache-Control": "no-store",
    },
  })
}
