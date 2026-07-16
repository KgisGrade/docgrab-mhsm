import type { NextRequest } from "next/server"
import { downloadSlideshare } from "@/lib/slideshare"
import { downloadScribd } from "@/lib/scribd"
import { checkRateLimit, getClientKey } from "@/lib/rate-limit"
import { registerDownload } from "@/lib/user-agent"
import type { StreamEvent, Logger, ProgressReporter, DownloadOptions, OutputFormat } from "@/lib/types"

export const maxDuration = 300
export const dynamic = "force-dynamic"

function normalizeUrl(raw: string): string | null {
  let url = raw.trim()
  if (!url) return null
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null
    return parsed.toString()
  } catch {
    return null
  }
}

function detectPlatform(url: string): "slideshare" | "scribd" | null {
  try {
    const host = new URL(url).hostname.toLowerCase()
    if (host === "slideshare.net" || host.endsWith(".slideshare.net")) return "slideshare"
    if (host === "scribd.com" || host.endsWith(".scribd.com")) return "scribd"
    return null
  } catch {
    return null
  }
}

export async function POST(request: NextRequest) {
  const limit = checkRateLimit(getClientKey(request.headers))
  if (!limit.allowed) {
    return Response.json(
      {
        error: `Rate limit reached. Try again in ${limit.retryAfterSeconds}s. (Max 5 downloads per 10 minutes.)`,
      },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    )
  }

  let body: { url?: string; format?: string; uploadToCatbox?: boolean; catboxUserhash?: string }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 })
  }

  const url = normalizeUrl(body.url ?? "")
  if (!url) {
    return Response.json({ error: "No valid URL provided" }, { status: 400 })
  }

  const platform = detectPlatform(url)
  if (!platform) {
    return Response.json({ error: "Unsupported platform. Use a SlideShare or Scribd URL." }, { status: 400 })
  }

  const format: OutputFormat = body.format === "pptx" ? "pptx" : "pdf"
  const userhash = typeof body.catboxUserhash === "string" ? body.catboxUserhash.trim() : ""
  const options: DownloadOptions = {
    format,
    // Any userhash implies the user wants to save it (permanently to catbox).
    uploadToCatbox: body.uploadToCatbox === true || userhash.length > 0,
    catboxUserhash: userhash || undefined,
  }

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false
      const send = (event: StreamEvent) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`))
        } catch {
          closed = true
        }
      }

      const log: Logger = (level, message) => {
        send({ type: "log", level, message, timestamp: Date.now() })
      }
      const progress: ProgressReporter = (current, total, label) => {
        send({ type: "progress", current, total, label })
      }

      try {
        log("info", `Platform detected: ${platform}`)
        log("info", `Target URL: ${url}`)

        // Count this download for User-Agent rotation (rotates every 50).
        registerDownload()

        const { result, error } =
          platform === "slideshare"
            ? await downloadSlideshare(url, log, progress, options)
            : await downloadScribd(url, log, progress, options)

        if (error || !result) {
          log("error", error ?? "Unknown failure")
          send({ type: "error", message: error ?? "Unknown failure" })
        } else {
          send({ type: "result", ...result, platform })
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Unexpected server error"
        send({ type: "log", level: "error", message: msg, timestamp: Date.now() })
        send({ type: "error", message: msg })
      } finally {
        closed = true
        try {
          controller.close()
        } catch {
          // already closed
        }
      }
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  })
}
