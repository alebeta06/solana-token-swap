const LINKS = [
  { label: "GitHub", href: "https://github.com/alebeta06", testId: "link-github" },
  { label: "X", href: "https://x.com/Ale_Beta", testId: "link-x" },
  { label: "LinkedIn", href: "https://www.linkedin.com/in/alebeta/", testId: "link-linkedin" },
];

export function Footer() {
  return (
    <footer className="mt-12 flex flex-wrap items-center justify-between gap-4 border-t border-line pt-6 text-sm text-muted">
      <span>CodeCrypto Máster · Module 15 · Alejandro Beta</span>
      <nav className="flex gap-5">
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
