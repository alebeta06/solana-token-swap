import { txUrl, shorten } from "@/lib/explorer";

export function TxResult({ signature }: { signature: string }) {
  return (
    <div
      data-testid="tx-result"
      className="rounded-xl border border-sol-green/40 bg-sol-green/10 p-3 text-sm"
    >
      <span className="font-semibold text-sol-green">Confirmed</span>{" "}
      <a
        className="font-mono underline decoration-line underline-offset-2 hover:text-text"
        href={txUrl(signature)}
        target="_blank"
        rel="noreferrer"
        data-testid="tx-link"
      >
        {shorten(signature, 8)} ↗
      </a>
    </div>
  );
}
