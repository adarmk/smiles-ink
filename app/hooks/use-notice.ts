import { useCallback, useEffect, useRef, useState } from "react";
import type { NoticeTone } from "../lib/types";

const NOTICE_DURATION_MS = 3200;

/** A single transient status message. */
export function useNotice() {
  const [notice, setNotice] = useState<string | null>(null);
  const [noticeTone, setNoticeTone] = useState<NoticeTone>("neutral");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showNotice = useCallback(
    (message: string, tone: NoticeTone = "neutral") => {
      if (timerRef.current) clearTimeout(timerRef.current);
      setNoticeTone(tone);
      setNotice(message);
      timerRef.current = setTimeout(() => setNotice(null), NOTICE_DURATION_MS);
    },
    [],
  );

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  return { notice, noticeTone, showNotice };
}
