import { savePdf } from "./store"
import type { Logger, ProgressReporter } from "./types"

interface ScribdResult {
  id: string
  title: string
  pages: number
  size: string
}

/** Locate a Chrome/Chromium executable: local system first, then serverless chromium. */
async function launchBrowser(log: Logger) {
  const puppeteer = await import("puppeteer-core")

  const localCandidates = [
    process.env.CHROME_PATH,
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/opt/homebrew/bin/chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].filter(Boolean) as string[]

  const { existsSync } = await import("fs")
  const commonArgs = [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--hide-scrollbars",
    "--disable-blink-features=AutomationControlled",
  ]

  for (const path of localCandidates) {
    if (existsSync(path)) {
      log("info", `Launching local Chromium: ${path}`)
      return puppeteer.launch({
        executablePath: path,
        headless: true,
        args: commonArgs,
        defaultViewport: { width: 1600, height: 2200 },
      })
    }
  }

  log("info", "No local Chromium found, using serverless chromium build...")
  const chromium = (await import("@sparticuz/chromium")).default
  const executablePath = await chromium.executablePath()
  return puppeteer.launch({
    executablePath,
    headless: true,
    args: [...chromium.args, ...commonArgs],
    defaultViewport: { width: 1600, height: 2200 },
  })
}

export async function downloadScribd(
  url: string,
  log: Logger,
  progress: ProgressReporter,
): Promise<{ result?: ScribdResult; error?: string }> {
  log("step", "Starting Scribd pipeline")

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
    log("success", `PDF exported: ${(pdfBuffer.length / 1024 / 1024).toFixed(1)} MB`)

    const id = await savePdf(pdfBuffer, title)
    log("success", "PDF stored and ready for download")

    return {
      result: {
        id,
        title,
        pages: pageCount,
        size: `${(pdfBuffer.length / 1024 / 1024).toFixed(1)} MB`,
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
