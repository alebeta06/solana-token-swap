const LINKS = [
  { label: "GitHub", href: "https://github.com/alebeta06", testId: "link-github" },
  { label: "X", href: "https://x.com/Ale_Beta", testId: "link-x" },
  { label: "LinkedIn", href: "https://www.linkedin.com/in/alebeta/", testId: "link-linkedin" },
];

const DEMO_VIDEO_URL = "https://www.youtube.com/watch?v=nUb5637SPXo";

export function Footer() {
  return (
    <footer className="mt-12 flex flex-col items-center gap-4 border-t border-line pt-6 text-sm text-muted">
      <a
        href={DEMO_VIDEO_URL}
        target="_blank"
        rel="noreferrer"
        data-testid="link-demo-video"
        className="rounded-full border border-line bg-surface-2 px-3 py-1 text-sm text-muted transition-colors hover:border-sol-purple hover:text-text"
      >
        ▶ Watch the demo on YouTube
      </a>
      <nav className="flex flex-wrap justify-center gap-6">
        {LINKS.map((link) => (
          <a
            key={link.label}
            href={link.href}
            target="_blank"
            rel="noreferrer"
            data-testid={link.testId}
            className="transition-colors hover:text-sol-green"
          >
            {link.label}
          </a>
        ))}
      </nav>
    </footer>
  );
}
