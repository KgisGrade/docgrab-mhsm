import { Downloader } from "@/components/downloader"
import { History } from "@/components/history"

const GITHUB_URL = process.env.NEXT_PUBLIC_GITHUB_URL || "https://github.com/KgisGrade/docgrab-mhsm"

function GithubIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.55 0-.27-.01-1.17-.02-2.12-3.2.7-3.87-1.36-3.87-1.36-.52-1.33-1.28-1.68-1.28-1.68-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.03 1.76 2.69 1.25 3.35.96.1-.75.4-1.25.72-1.54-2.55-.29-5.24-1.28-5.24-5.68 0-1.26.45-2.28 1.18-3.09-.12-.29-.51-1.46.11-3.05 0 0 .96-.31 3.16 1.18a11 11 0 0 1 2.88-.39c.98 0 1.96.13 2.88.39 2.2-1.49 3.16-1.18 3.16-1.18.62 1.59.23 2.76.11 3.05.74.81 1.18 1.83 1.18 3.09 0 4.41-2.69 5.38-5.25 5.67.41.35.77 1.05.77 2.12 0 1.53-.01 2.76-.01 3.14 0 .31.2.67.8.55A11.51 11.51 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
    </svg>
  )
}

export default function Home() {
  return (
    <main className="relative z-10 min-h-dvh flex flex-col">
      <div className="mx-auto w-full max-w-2xl px-4 py-16 sm:py-24 flex-1 flex flex-col gap-8">
        <header className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <span aria-hidden="true" className="size-2 rounded-full bg-primary" />
            <span className="text-xs font-mono uppercase tracking-widest text-muted-foreground">docgrab</span>
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto rounded-md border border-border bg-card p-2 text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
            >
              <GithubIcon className="size-4" />
              <span className="sr-only">View source on GitHub</span>
            </a>
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

        <History />

        <footer className="mt-auto pt-8 border-t border-border flex flex-col items-center gap-4">
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-6 text-xs font-mono text-muted-foreground/60">
            <span>slideshare · pdf / pptx pipeline</span>
            <span>scribd · headless chromium export</span>
            <span>local files auto-delete after 1h · catbox saves are permanent</span>
          </div>
          <p className="text-xs font-mono text-muted-foreground/70 text-center">
            Made by Mhsm with Claude Sonnet 4.5
          </p>
        </footer>
      </div>
    </main>
  )
}
