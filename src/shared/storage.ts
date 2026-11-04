import { Effect, Schema } from "effect";
import { Connection, Settings } from "../domain/Connection.ts";
import { RestyleStatus, PickedElement } from "../domain/Restyle.ts";
import { SiteStyle } from "../domain/SiteStyle.ts";
import { statusKey, pickedKey, siteStyleKey } from "./keys.ts";

export class StorageError extends Schema.TaggedError<StorageError>()("StorageError", {
  message: Schema.String,
}) {}

type Area = "local" | "session";

const read = <S extends Schema.Top>(area: Area, key: string, schema: S) =>
  Effect.tryPromise({
    try: () => chrome.storage[area].get(key),
    catch: (cause) => new StorageError({ message: `Could not read ${key}: ${String(cause)}` }),
  }).pipe(
    Effect.flatMap((items) => {
      const value: unknown = items[key];
      if (value === undefined) return Effect.succeed(null);
      // A value that no longer matches its schema is treated as missing.
      return Schema.decodeUnknownEffect(schema)(value).pipe(Effect.orElseSucceed(() => null));
    }),
  );

const write = (area: Area, key: string, value: unknown) =>
  Effect.tryPromise({
    try: () => chrome.storage[area].set({ [key]: value }),
    catch: (cause) => new StorageError({ message: `Could not save ${key}: ${String(cause)}` }),
  });

const remove = (area: Area, key: string) =>
  Effect.tryPromise({
    try: () => chrome.storage[area].remove(key),
    catch: (cause) => new StorageError({ message: `Could not remove ${key}: ${String(cause)}` }),
  });

const Connections = Schema.Array(Connection);

export const getConnections = read("local", "connections", Connections).pipe(
  Effect.map((connections) => connections ?? []),
);
const putConnections = (connections: ReadonlyArray<Connection>) =>
  write("local", "connections", connections);

export const getSettings = read("local", "settings", Settings).pipe(
  Effect.map((settings): Settings => settings ?? { activeConnectionId: null }),
);
export const putSettings = (settings: Settings) => write("local", "settings", settings);

export const saveConnection = Effect.fnUntraced(function* (connection: Connection) {
  const connections = yield* getConnections;
  const exists = connections.some((existing) => existing.id === connection.id);
  yield* putConnections(
    exists
      ? connections.map((existing) => (existing.id === connection.id ? connection : existing))
      : [...connections, connection],
  );
  const settings = yield* getSettings;
  if (!settings.activeConnectionId) yield* putSettings({ activeConnectionId: connection.id });
});

export const deleteConnection = Effect.fnUntraced(function* (id: string) {
  const connections = yield* getConnections;
  const remaining = connections.filter((connection) => connection.id !== id);
  yield* putConnections(remaining);
  const settings = yield* getSettings;
  if (settings.activeConnectionId === id) {
    yield* putSettings({ activeConnectionId: remaining[0]?.id ?? null });
  }
});

export const getSiteStyle = (origin: string) => read("local", siteStyleKey(origin), SiteStyle);
export const putSiteStyle = (style: SiteStyle) => write("local", siteStyleKey(style.origin), style);
export const deleteSiteStyle = (origin: string) => remove("local", siteStyleKey(origin));

export const listSiteStyles = Effect.tryPromise({
  try: () => chrome.storage.local.get(null),
  catch: (cause) => new StorageError({ message: `Could not read site styles: ${String(cause)}` }),
}).pipe(
  Effect.map((items) =>
    Object.entries(items).flatMap(([key, value]) => {
      if (!key.startsWith("site:")) return [];
      const decoded = Schema.decodeUnknownOption(SiteStyle)(value);
      return decoded._tag === "Some" ? [decoded.value] : [];
    }),
  ),
);

export const getHostId = Effect.gen(function* () {
  const existing = yield* read("local", "hostId", Schema.String);
  if (existing) return existing;
  const hostId = `urn:uuid:${crypto.randomUUID()}`;
  yield* write("local", "hostId", hostId);
  return hostId;
});

export const getStatus = (tabId: number) => read("session", statusKey(tabId), RestyleStatus);
export const putStatus = (tabId: number, status: RestyleStatus) =>
  write("session", statusKey(tabId), status);
export const clearStatus = (tabId: number) => remove("session", statusKey(tabId));

/**
 * Marks Restyle Requests that were running when the service worker stopped as
 * failed; nothing will ever finish them.
 */
export const failInterruptedRequests = Effect.tryPromise({
  try: () => chrome.storage.session.get(null),
  catch: (cause) => new StorageError({ message: `Could not read statuses: ${String(cause)}` }),
}).pipe(
  Effect.flatMap((items) =>
    Effect.forEach(Object.entries(items), ([key, value]) => {
      const status = Schema.decodeUnknownOption(RestyleStatus)(value);
      if (!key.startsWith("status:") || status._tag === "None" || status.value._tag !== "Running") {
        return Effect.void;
      }
      return write("session", key, {
        _tag: "Failed",
        prompt: status.value.prompt,
        message: "vibecheck was stopped before the reply arrived. Try again.",
      });
    }),
  ),
);

export const getPicked = (tabId: number) => read("session", pickedKey(tabId), PickedElement);
export const putPicked = (tabId: number, picked: PickedElement) =>
  write("session", pickedKey(tabId), picked);
export const clearPicked = (tabId: number) => remove("session", pickedKey(tabId));

export const readSession = <S extends Schema.Top>(key: string, schema: S) =>
  read("session", key, schema);
export const writeSession = (key: string, value: unknown) => write("session", key, value);
export const removeSession = (key: string) => remove("session", key);
