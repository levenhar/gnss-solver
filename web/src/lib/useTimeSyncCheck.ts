import { useEffect, useRef, useState } from "react";
import { client } from "../api/client";

export type TimeSyncStatus = "idle" | "checking" | "ok" | "blocked" | "unknown";

export interface TimeSyncState {
  status: TimeSyncStatus;
  issues: string[];
}

const DEBOUNCE_MS = 400;
const IDLE: TimeSyncState = { status: "idle", issues: [] };

function fileKey(f: File | null): string {
  return f ? `${f.name}:${f.size}:${f.lastModified}` : "-";
}

/** Checks rover/base(s)/nav observation windows overlap, debounced on file identity.
 *  Fails open ("unknown") on network/server error - never blocks submit on our own check failing. */
export function useTimeSyncCheck(rover: File | null, bases: (File | null)[], nav: File[]): TimeSyncState {
  const [state, setState] = useState<TimeSyncState>(IDLE);
  const requestId = useRef(0);
  const validBases = bases.filter((b): b is File => b !== null);
  const depKey = [fileKey(rover), ...validBases.map(fileKey), ...nav.map(fileKey)].join(",");

  useEffect(() => {
    const id = ++requestId.current;
    if (!rover || nav.length === 0) {
      setState(IDLE);
      return;
    }
    setState({ status: "checking", issues: [] });
    const controller = new AbortController();
    const timer = setTimeout(() => {
      try {
        const fd = new FormData();
        fd.append("rover", rover);
        for (const n of nav) fd.append("nav", n);
        for (const b of validBases) fd.append("base", b);
        client
          .checkTimeSync(fd, controller.signal)
          .then((res) => {
            if (requestId.current !== id) return;
            setState(res.ok ? { status: "ok", issues: [] } : { status: "blocked", issues: res.issues });
          })
          .catch(() => {
            if (requestId.current !== id) return;
            setState({ status: "unknown", issues: [] });
          });
      } catch {
        if (requestId.current !== id) return;
        setState({ status: "unknown", issues: [] });
      }
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depKey]);

  return state;
}
