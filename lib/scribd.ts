import { saveFile, slugify } from "./store"
import { launchBrowser } from "./browser"
import { uploadToCatbox } from "./catbox"
import type { Logger, ProgressReporter, DownloadOptions } from "./types"

interface ScribdResult {
  id: string
  title: string
  pages: number
  size: string
  format: "pdf"
  catboxUrl?: string
}

export async function downloadScribd(
  url: string,
  log: Logger,
  progress: ProgressReporter,
  options: DownloadOptions = { format: "pdf", uploadToCatbox: false },
): Promise<{ result?: ScribdResult; error?: string }> {
  log("step", "Starting Scribd pipeline")
  if (options.format === "pptx") {
    log("warn", "PPTX is not supported for Scribd documents — exporting as PDF instead")
  }

  const match = url.match(/scribd\.com\/(?:document|doc|presentation)\/(\d+)/)
  if (!match) {
    return { error: "Invalid Scribd URL. Expected format: scribd.com/document/<id>/..." }
  }
  const docId = match[1]
  const embedUrl = `https://www.scribd.com/embeds/${docId}/content`
  log("info", `Document ID: ${docId}`)

  let title = `Scribd ${docId}`
  try {
    const pathname = new URL(url).pathname.replace(/\/$/, "")
    const lastSegment = decodeURIComponent(pathname.split("/").pop() ?? "")
    if (lastSegment && !/^\d+$/.test(lastSegment)) {
      title = lastSegment.replace(/-/g, " ")
    }
  } catch {
    // keep fallback title
  }
  log("info", `Resolved title: ${title}`)

  let browser: Awaited<ReturnType<typeof launchBrowser>> | null = null
  try {
    log("step", "Launching headless browser...")
    browser = await launchBrowser(log)
    const page = await browser.newPage()
    page.setDefaultTimeout(60000)

    log("info", `Loading embed page: ${embedUrl}`)
    await page.goto(embedUrl, { waitUntil: "networkidle2", timeout: 60000 })
    await new Promise((r) => setTimeout(r, 2000))

    // Remove cookie/consent banners
    log("info", "Removing consent banners and overlays...")
    await page.evaluate(() => {
      const selectors = [
        '[class*="cookie"]',
        '[class*="consent"]',
        '[id*="cookie"]',
        "#onetrust-consent-sdk",
        ".cc-window",
      ]
      for (const s of selectors) {
        try {
          document.querySelectorAll(s).forEach((e) => e.remove())
        } catch {
          // ignore selector errors
        }
      }
    })

    // Scroll through pages to trigger lazy loading, until page count stabilizes
    log("step", "Scrolling document to trigger lazy loading...")
    let scrolled = 0
    let stable = 0
    let lastTotal = -1
    let pageCount = 0
    const maxIterations = 200

    for (let iter = 0; iter < maxIterations && stable < 2; iter++) {
      const total = await page.evaluate(() => document.querySelectorAll("[class*='page']").length)
      if (total === 0) {
        return { error: "No pages found. The document may be restricted or removed." }
      }
      if (total === lastTotal) {
        stable++
      } else {
        stable = 0
        progress(total, total, "Loading pages")
        log("info", `Discovered ${total} page elements so far...`)
      }
      lastTotal = total

      for (let i = scrolled; i < total; i++) {
        await page.evaluate((idx) => {
          const pages = document.querySelectorAll("[class*='page']")
          pages[idx]?.scrollIntoView({ behavior: "instant" as ScrollBehavior, block: "center" })
        }, i)
        await new Promise((r) => setTimeout(r, 120))
      }
      scrolled = total
      pageCount = total
      await new Promise((r) => setTimeout(r, 500))
    }
    log("success", `All ${pageCount} pages loaded`)

    // Strip toolbars and inject print CSS
    log("info", "Preparing document layout for PDF export...")
    await page.evaluate(() => {
      document.querySelector(".toolbar_top")?.remove()
      document.querySelector(".toolbar_bottom")?.remove()
      document.querySelectorAll<HTMLElement>(".document_scroller").forEach((el) => {
        el.style.position = "static"
        el.style.overflow = "visible"
        el.style.maxHeight = "none"
        el.style.height = "auto"
        el.style.margin = "0"
        el.style.padding = "0"
      })
      const style = document.createElement("style")
      style.textContent = `
        @media print {
          @page { margin: 0; }
          html, body { margin: 0 !important; padding: 0 !important; -webkit-print-color-adjust: exact !important; }
          .toolbar_top, .toolbar_bottom { display: none !important; }
          .document_scroller { position: static !important; overflow: visible !important; height: auto !important; max-height: none !important; }
          .outer_page { margin: 0 !important; break-inside: avoid !important; break-after: page !important; }
          .outer_page:last-of-type { break-after: auto !important; }
        }`
      document.head.appendChild(style)
    })

    // Wait for render stability (images loaded, page count settled)
    log("info", "Waiting for render to stabilize...")
    try {
      await page.evaluate(() => {
        return new Promise<void>((resolve) => {
          let stableCount = 0
          let last = ""
          const timeout = setTimeout(resolve, 20000)
          const check = () => {
            const state = JSON.stringify({
              imgs: Array.from(document.images || []).filter((i) => !i.complete).length,
              pgs: document.querySelectorAll("[class*='page']").length,
            })
            if (state === last) stableCount++
            else stableCount = 0
            last = state
            if (stableCount >= 3) {
              clearTimeout(timeout)
              resolve()
            } else {
              setTimeout(check, 300)
            }
          }
          const fontsReady = document.fonts?.ready ?? Promise.resolve()
          fontsReady.then(() => setTimeout(check, 500)).catch(() => setTimeout(check, 500))
        })
      })
    } catch {
      log("warn", "Render stability check timed out, proceeding anyway")
    }

    // Detect actual page dimensions for the PDF paper size
    const paper = await page.evaluate(() => {
      for (const s of [".outer_page", ".newpage", "[class*='page']"]) {
        const el = document.querySelector(s)
        if (el) {
          const r = el.getBoundingClientRect()
          if (r.width > 0 && r.height > 0) return { w: r.width / 96, h: r.height / 96 }
        }
      }
      return null
    })
    const paperWidth = paper ? Math.max(1, Math.round(paper.w * 1000) / 1000) : 7.25
    const paperHeight = paper ? Math.max(1, Math.round(paper.h * 1000) / 1000) : 10.5
    log("info", `Detected page size: ${paperWidth.toFixed(2)}in x ${paperHeight.toFixed(2)}in`)

    log("step", "Exporting PDF via DevTools protocol...")
    const pdfBuffer = Buffer.from(
      await page.pdf({
        landscape: false,
        displayHeaderFooter: false,
        printBackground: true,
        scale: 1,
        width: `${paperWidth}in`,
        height: `${paperHeight}in`,
        margin: { top: 0, bottom: 0, left: 0, right: 0 },
        preferCSSPageSize: false,
        timeout: 300000,
      }),
    )

    if (pdfBuffer.length < 1000) {
      return { error: "PDF export returned an empty result." }
    }
    const sizeMb = `${(pdfBuffer.length / 1024 / 1024).toFixed(1)} MB`
    log("success", `PDF exported: ${sizeMb}`)

    const id = await saveFile(pdfBuffer, title, "pdf")
    log("success", "PDF stored and ready for download")

    let catboxUrl: string | undefined
    if (options.uploadToCatbox) {
      const { url: uploaded } = await uploadToCatbox(pdfBuffer, `${slugify(title)}.pdf`, "application/pdf", log)
      catboxUrl = uploaded
    }

    return {
      result: {
        id,
        title,
        pages: pageCount,
        size: sizeMb,
        format: "pdf",
        catboxUrl,
      },
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error"
    return { error: `Browser error: ${msg}` }
  } finally {
    if (browser) {
      try {
        await browser.close()
      } catch {
        // ignore close errors
      }
    }
  }
}
