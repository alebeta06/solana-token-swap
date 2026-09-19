"use client";

import { useEffect, useRef } from "react";
import { startDismissTimer, type BannerKind } from "@/lib/banner";

/**
 * Hides a banner on its own when —and only when— it is a success.
 *
 * `key` identifies WHICH banner is on screen: cuando llega un éxito nuevo
 * mientras el anterior sigue visible, cambia y el temporizador se rearma desde
 * cero. Sin él, el segundo éxito heredaría lo que le quedaba al primero.
 *
 * 🇪🇸 NOTA: `dismiss` va en una ref para que volver a renderizar con otra
 * función no reinicie la cuenta. La regla y el plazo viven en `@/lib/banner`,
 * que sí tiene tests.
 */
export function useAutoDismiss(
  key: string | null,
  kind: BannerKind | null,
  dismiss: () => void
) {
  const latest = useRef(dismiss);
  latest.current = dismiss;

  useEffect(() => {
    if (key === null) return;
    return startDismissTimer(kind, () => latest.current());
  }, [key, kind]);
}
