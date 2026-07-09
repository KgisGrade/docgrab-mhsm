import type { Logger } from "./types"

/**
 * Launch a headless Chrome/Chromium with a real browser TLS fingerprint.
 * This is the strongest Cloudflare bypass available (same principle as
 * curl_cffi's impersonation, but with an actual Chrome network stack).
 * Tries local system Chromium first, then the serverless chromium build.
 */
export async function launchBrowser(log: Logger) {
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

/**
 * Fetch a page's fully rendered HTML using headless Chrome.
 * Bypasses Cloudflare TLS fingerprinting because it IS a real Chrome.
 */
export async function fetchHtmlWithBrowser(url: string, log: Logger, timeoutMs = 60000): Promise<string | null> {
  let browser: Awaited<ReturnType<typeof launchBrowser>> | null = null
  try {
    browser = await launchBrowser(log)
    const page = await browser.newPage()
    page.setDefaultTimeout(timeoutMs)
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs })
    // Give Cloudflare's JS challenge a moment to auto-resolve if present
    try {
      await page.waitForFunction(
        () => !document.title.toLowerCase().includes("just a moment") && document.body?.innerHTML.length > 5000,
        { timeout: 15000 },
      )
    } catch {
      log("warn", "Challenge wait timed out, using current page state")
    }
    return await page.content()
  } catch (e) {
    log("warn", `Browser fetch failed: ${e instanceof Error ? e.message : "unknown error"}`)
    return null
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
