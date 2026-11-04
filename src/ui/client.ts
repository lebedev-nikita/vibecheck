import { Effect, Schema } from "effect";
import { useEffect, useRef, useState } from "react";
import { Reply, type Request } from "../domain/Messages.ts";

/** Sends a request to the service worker and unwraps its reply. */
export const send = async (request: Request): Promise<unknown> => {
  const reply = Schema.decodeUnknownSync(Reply)(await chrome.runtime.sendMessage(request));
  if (reply._tag === "Error") throw new Error(reply.message);
  return reply.value;
};

export const sendFor = async <S extends Schema.Decoder<unknown>>(
  schema: S,
  request: Request,
): Promise<S["Type"]> => Schema.decodeUnknownPromise(schema)(await send(request));

export const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/** Runs an action from an event handler and keeps its failure as a message to show. */
export const useAttempt = () => {
  const [error, setError] = useState<string | null>(null);
  const attempt = (action: () => Promise<unknown>) => {
    setError(null);
    action().catch((cause: unknown) => setError(errorMessage(cause)));
  };
  return [error, attempt] as const;
};

/**
 * Reads a storage-backed value and follows its changes. `undefined` means
 * still loading; the effect decides what a missing value becomes.
 */
export const useStored = <A>(
  area: "local" | "session",
  key: string | null,
  load: Effect.Effect<A, unknown>,
): A | undefined => {
  const [value, setValue] = useState<A | undefined>(undefined);
  // `load` is rebuilt on every render; the key identifies what it reads.
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    if (key === null) return;
    let active = true;
    const refresh = () =>
      void Effect.runPromise(loadRef.current).then(
        (next) => active && setValue(next),
        () => undefined,
      );
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>) => {
      if (key in changes) refresh();
    };
    refresh();
    chrome.storage[area].onChanged.addListener(onChanged);
    return () => {
      active = false;
      chrome.storage[area].onChanged.removeListener(onChanged);
    };
  }, [area, key]);
  return value;
};

/** Whether Chrome lets vibecheck run Page Scripts (the "Allow User Scripts" toggle). */
export const useUserScriptsAvailable = () => {
  const [available, setAvailable] = useState<boolean | undefined>(undefined);
  useEffect(() => {
    const check = async () => {
      try {
        await chrome.userScripts.getScripts();
        return true;
      } catch {
        return false;
      }
    };
    void check().then(setAvailable);
  }, []);
  return available;
};

export const openUserScriptsSettings = () =>
  void chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` });

export const relativeTime = (timestamp: number) => {
  const seconds = Math.round((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(timestamp).toLocaleDateString();
};
