import { Downloader } from "@/components/downloader"

export default function Home() {
  return (
    <main className="min-h-dvh flex flex-col">
      <div className="mx-auto w-full max-w-2xl px-4 py-16 sm:py-24 flex-1 flex flex-col gap-8">
        <header className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <span aria-hidden="true" className="size-2 rounded-full bg-primary" />
            <span className="text-xs font-mono uppercase tracking-widest text-muted-foreground">docgrab v2</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-foreground text-balance">
            Grab documents as PDF.
          </h1>
          <p className="text-sm text-muted-foreground leading-relaxed max-w-md text-pretty">
            {
              "Paste a SlideShare or Scribd link. DocGrab fetches every page, rebuilds the document, and hands you a clean PDF — with the full process log streamed live."
            }
          </p>
        </header>

        <Downloader />

        <footer className="mt-auto pt-8 border-t border-border">
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-6 text-xs font-mono text-muted-foreground/60">
            <span>slideshare · cdn image pipeline</span>
            <span>scribd · headless chromium export</span>
            <span>files auto-delete after 1h</span>
          </div>
        </footer>
      </div>
    </main>
  )
}
