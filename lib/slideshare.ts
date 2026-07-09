import { buildPdfFromJpegs, isJpeg } from "./pdf"
import { savePdf } from "./store"
import type { Logger, ProgressReporter } from "./types"

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"

const IMAGE_CONCURRENCY = 8
const IMAGE_RETRIES = 2

interface SlideshareResult {
  id: string
  title: string
  pages: number
  size: string
}

async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 30000): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

/** Fetch the SlideShare page HTML, trying direct fetch first, then Jina Reader as fallback. */
async function fetchPageHtml(url: string, log: Logger): Promise<string | null> {
  // Attempt 1: direct fetch (fastest when not blocked)
  try {
    log("info", "Fetching page directly...")
    const resp = await fetchWithTimeout(url, { headers: { "User-Agent": UA, Accept: "text/html" } }, 20000)
    if (resp.ok) {
      const html = await resp.text()
      if (html.includes("slidesharecdn")) {
        log("success", "Direct fetch succeeded")
        return html
      }
      log("warn", "Direct fetch returned page without slide data")
    } else {
      log("warn", `Direct fetch blocked (HTTP ${resp.status})`)
    }
  } catch {
    log("warn", "Direct fetch failed, falling back to reader proxy")
  }

  // Attempt 2: Jina Reader (bypasses Cloudflare)
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      log("info", `Rendering via reader proxy (attempt ${attempt}/2)...`)
      const resp = await fetchWithTimeout(
        `https://r.jina.ai/${url}`,
        { headers: { Accept: "text/html", "X-Return-Format": "html" } },
        45000,
      )
      if (resp.ok) {
        log("success", "Reader proxy returned page HTML")
        return await resp.text()
      }
      log("warn", `Reader proxy returned HTTP ${resp.status}`)
    } catch (e) {
      log("warn", `Reader proxy attempt ${attempt} failed: ${e instanceof Error ? e.message : "unknown error"}`)
    }
  }
  return null
}

interface SlideInfo {
  baseUrl: string
  titleSlug: string
  maxPage: number
}

function extractSlideInfo(html: string): SlideInfo | null {
  const pageNums = new Set<number>()
  let baseUrl: string | null = null
  let titleSlug: string | null = null

  const urls = html.match(/https:\/\/image\.slidesharecdn\.com\/[^"'<>\s)\]]+/g) ?? []
  for (const raw of urls) {
    const clean = raw.split("?")[0]
    const m = clean.match(/(https:\/\/image\.slidesharecdn\.com\/[^/]+)\/\d+\/(.+)-(\d+)-\d+\.jpg/)
    if (m) {
      if (!baseUrl) {
        baseUrl = m[1]
        titleSlug = m[2]
      }
      pageNums.add(Number.parseInt(m[3], 10))
    }
  }

  if (!baseUrl || !titleSlug || pageNums.size === 0) return null
  return { baseUrl, titleSlug, maxPage: Math.max(...pageNums) }
}

function extractTitle(html: string, fallbackSlug: string): string {
  const m = html.match(/<title[^>]*>([^<]*)<\/title>/i)
  let title = m ? m[1].trim() : ""
  for (const suffix of [" | PPT", " - PowerPoint", " | PDF", " | SlideShare"]) {
    title = title.split(suffix)[0]
  }
  if (!title || title.toLowerCase().includes("challenge")) {
    title = fallbackSlug.replace(/-/g, " ")
  }
  return title
}

/** Download a single slide, trying highest resolution first, with retries. */
async function downloadSlide(baseUrl: string, slug: string, pageNum: number): Promise<Buffer | null> {
  const candidates = [
    `${baseUrl}/75/${slug}-${pageNum}-2048.jpg`,
    `${baseUrl}/85/${slug}-${pageNum}-638.jpg`,
    `${baseUrl}/85/${slug}-${pageNum}-320.jpg`,
  ]
  for (const url of candidates) {
    for (let attempt = 0; attempt <= IMAGE_RETRIES; attempt++) {
      try {
        const resp = await fetchWithTimeout(url, { headers: { "User-Agent": UA } }, 15000)
        if (resp.ok) {
          const buf = Buffer.from(await resp.arrayBuffer())
          if (isJpeg(buf)) return buf
        }
        break // non-OK or non-JPEG: try next candidate size instead of retrying
      } catch {
        // network error: retry with backoff
        if (attempt < IMAGE_RETRIES) {
          await new Promise((r) => setTimeout(r, 300 * (attempt + 1)))
        }
      }
    }
  }
  return null
}

/** Concurrency-limited parallel download of all slides, preserving order. */
async function downloadAllSlides(
  info: SlideInfo,
  log: Logger,
  progress: ProgressReporter,
): Promise<(Buffer | null)[]> {
  const results: (Buffer | null)[] = new Array(info.maxPage).fill(null)
  let completed = 0
  let next = 0

  const worker = async () => {
    while (next < info.maxPage) {
      const idx = next++
      results[idx] = await downloadSlide(info.baseUrl, info.titleSlug, idx + 1)
      completed++
      progress(completed, info.maxPage, "Downloading slides")
    }
  }

  const workers = Array.from({ length: Math.min(IMAGE_CONCURRENCY, info.maxPage) }, () => worker())
  await Promise.all(workers)

  const failed = results.filter((r) => r === null).length
  if (failed > 0) {
    log("warn", `${failed} of ${info.maxPage} slides could not be downloaded`)
  }
  return results
}

export async function downloadSlideshare(
  url: string,
  log: Logger,
  progress: ProgressReporter,
): Promise<{ result?: SlideshareResult; error?: string }> {
  log("step", "Starting SlideShare pipeline")

  const html = await fetchPageHtml(url, log)
  if (!html) {
    return { error: "Failed to fetch the SlideShare page after all attempts. Try again in a moment." }
  }

  log("info", "Parsing HTML for slide image CDN references...")
  const info = extractSlideInfo(html)
  if (!info) {
    return { error: "Could not find slide images on the page. The URL may be invalid or the deck is private." }
  }
  log("success", `Found deck "${info.titleSlug}" with ${info.maxPage} slides`)

  const title = extractTitle(html, info.titleSlug)
  log("info", `Resolved title: ${title}`)

  log("step", `Downloading ${info.maxPage} slides (${IMAGE_CONCURRENCY} parallel connections)...`)
  const slides = await downloadAllSlides(info, log, progress)
  const jpegs = slides.filter((s): s is Buffer => s !== null)

  if (jpegs.length === 0) {
    return { error: "Failed to download any slide images from the CDN." }
  }
  log("success", `Downloaded ${jpegs.length} slides successfully`)

  log("step", "Assembling PDF document...")
  const pdf = buildPdfFromJpegs(jpegs)
  if (!pdf) {
    return { error: "Failed to build PDF from downloaded slides." }
  }
  log("success", `PDF built: ${(pdf.length / 1024 / 1024).toFixed(1)} MB, ${jpegs.length} pages`)

  const id = await savePdf(pdf, title)
  log("success", "PDF stored and ready for download")

  return {
    result: {
      id,
      title,
      pages: jpegs.length,
      size: `${(pdf.length / 1024 / 1024).toFixed(1)} MB`,
    },
  }
}
