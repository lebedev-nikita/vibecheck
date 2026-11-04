import {
  Crosshair,
  History as HistoryIcon,
  LoaderCircle,
  Settings,
  Sparkles,
  X,
} from "lucide-react";
import { Effect } from "effect";
import {
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useState,
} from "react";
import { acceptsImages, type Connection, providerName } from "../domain/Connection.ts";
import type { Request } from "../domain/Messages.ts";
import {
  MAX_REFERENCE_IMAGES,
  type PickedElement,
  type ReferenceImage,
  type RestyleStatus,
} from "../domain/Restyle.ts";
import { originPattern, restylableOrigin, type SiteStyle } from "../domain/SiteStyle.ts";
import { statusKey, pickedKey, siteStyleKey } from "../shared/keys.ts";
import { downscaleToJpeg } from "../shared/images.ts";
import * as Storage from "../shared/storage.ts";
import {
  openUserScriptsSettings,
  relativeTime,
  send,
  useAttempt,
  useStored,
  useUserScriptsAvailable,
} from "../ui/client.ts";
import { Button, Code, cn, Notice, SelectField, Toggle } from "../ui/components.tsx";
import { ModelPicker } from "../ui/ModelPicker.tsx";

interface ActiveTab {
  readonly id: number;
  readonly url: string | undefined;
}

const useActiveTab = () => {
  const [tab, setTab] = useState<ActiveTab | null | undefined>(undefined);
  useEffect(() => {
    void chrome.tabs.query({ active: true, currentWindow: true }).then(([active]) => {
      setTab(active?.id === undefined ? null : { id: active.id, url: active.url });
    });
  }, []);
  return tab;
};

const useSitePermission = (origin: string | null) => {
  const [granted, setGranted] = useState(false);
  useEffect(() => {
    if (!origin) return;
    void chrome.permissions.contains({ origins: [originPattern(origin)] }).then(setGranted);
  }, [origin]);
  return [granted, setGranted] as const;
};

/** Writes a setting from an event handler; failures leave the old value in place. */
const persist = <A, E>(effect: Effect.Effect<A, E>) =>
  void Effect.runPromise(Effect.ignore(effect));

export const Popup = () => {
  const tab = useActiveTab();
  const origin = restylableOrigin(tab?.url);
  if (tab === undefined) return <Shell />;
  if (!origin || tab === null) {
    return (
      <Shell>
        <p className="px-4 py-6 text-center text-[13px] text-zinc-500">
          vibecheck works on regular websites. Open one and try again.
        </p>
      </Shell>
    );
  }
  return <SitePanel tabId={tab.id} origin={origin} />;
};

const SitePanel = ({ tabId, origin }: { tabId: number; origin: string }) => {
  const connections = useStored("local", "connections", Storage.getConnections);
  const settings = useStored("local", "settings", Storage.getSettings);
  const style = useStored("local", siteStyleKey(origin), Storage.getSiteStyle(origin));
  const status = useStored("session", statusKey(tabId), Storage.getStatus(tabId));
  const scriptsAvailable = useUserScriptsAvailable();
  const [error, attempt] = useAttempt();

  useEffect(() => {
    // Picks up a changed "Allow User Scripts" toggle.
    void send({ _tag: "Sync" }).catch(() => undefined);
  }, []);

  const run = (request: Request) => attempt(() => send(request));
  const connection =
    connections?.find((candidate) => candidate.id === settings?.activeConnectionId) ??
    connections?.[0];

  return (
    <Shell
      origin={origin}
      toggle={
        style && (
          <Toggle
            label="Apply this Site Style"
            checked={style.enabled}
            onChange={(enabled) => run({ _tag: "SetEnabled", tabId, origin, enabled })}
          />
        )
      }
    >
      <div className="flex flex-col gap-3 p-3">
        {scriptsAvailable === false && <ScriptsOffNotice />}
        {connections &&
          (connection ? (
            <RestylePanel
              tabId={tabId}
              origin={origin}
              connections={connections}
              connection={connection}
              running={status?._tag === "Running"}
              onRequest={run}
            />
          ) : (
            <NoConnection />
          ))}
        {error && <Notice tone="error">{error}</Notice>}
        {status && (
          <StatusLine status={status} onCancel={() => run({ _tag: "CancelRestyle", tabId })} />
        )}
        {style && style.revisions.length > 0 && (
          <History
            style={style}
            scriptsAvailable={scriptsAvailable !== false}
            onRestore={(revisionId) => run({ _tag: "RestoreRevision", tabId, origin, revisionId })}
          />
        )}
      </div>
    </Shell>
  );
};

const ScriptsOffNotice = () => (
  <Notice
    action={
      <button
        type="button"
        className="font-medium underline underline-offset-2"
        onClick={openUserScriptsSettings}
      >
        Enable
      </button>
    }
  >
    Page Scripts are off, so vibecheck can only change CSS. Turn on “Allow User Scripts” for
    vibecheck.
  </Notice>
);

const NoConnection = () => (
  <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-zinc-300 px-4 py-6 text-center dark:border-zinc-700">
    <p className="text-[13px] text-zinc-600 dark:text-zinc-400">
      Connect an AI provider to start restyling sites.
    </p>
    <Button variant="primary" onClick={() => void chrome.runtime.openOptionsPage()}>
      Add a connection
    </Button>
  </div>
);

const RestylePanel = ({
  tabId,
  origin,
  connections,
  connection,
  running,
  onRequest,
}: {
  tabId: number;
  origin: string;
  connections: ReadonlyArray<Connection>;
  connection: Connection;
  running: boolean;
  onRequest: (request: Request) => void;
}) => {
  const picked = useStored("session", pickedKey(tabId), Storage.getPicked(tabId));
  const [hasPermission, setHasPermission] = useSitePermission(origin);

  const restyle = (prompt: string, references: ReadonlyArray<ReferenceImage>) => {
    onRequest({
      _tag: "Restyle",
      tabId,
      prompt,
      connectionId: connection.id,
      model: connection.model,
      references,
    });
    // Asking now, inside the click, keeps the Site Style applying on every visit.
    if (!hasPermission) {
      void chrome.permissions
        .request({ origins: [originPattern(origin)] })
        .then(setHasPermission, () => undefined);
    }
  };

  return (
    <>
      <ConnectionPicker connections={connections} connection={connection} />
      <Composer
        running={running}
        blocked={connection.model ? null : "Choose a model to restyle with."}
        acceptsImages={acceptsImages(connection)}
        picked={picked ?? null}
        onPick={() => {
          onRequest({ _tag: "StartPicker", tabId });
          window.close();
        }}
        onClearPicked={() => void chrome.storage.session.remove(pickedKey(tabId))}
        onSubmit={restyle}
      />
      <p className="text-[11px] leading-snug text-zinc-500">
        The page outline, a screenshot of the visible area and any attached images are sent to{" "}
        {providerName(connection._tag)}.
      </p>
    </>
  );
};

const Shell = ({
  origin,
  toggle,
  children,
}: {
  origin?: string;
  toggle?: ReactNode;
  children?: ReactNode;
}) => (
  <main className="flex max-h-[600px] min-h-40 w-[380px] flex-col bg-white font-sans text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
    <header className="flex items-center gap-2 border-b border-zinc-200 px-3 py-2.5 dark:border-zinc-800">
      <img src="/icons/32.png" alt="" className="size-5 rounded" />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-[13px] leading-tight font-semibold">vibecheck</span>
        {origin && (
          <span className="truncate text-[11px] leading-tight text-zinc-500">
            {new URL(origin).host}
          </span>
        )}
      </div>
      {toggle}
      <Button
        variant="ghost"
        className="size-8 px-0"
        aria-label="Settings"
        onClick={() => void chrome.runtime.openOptionsPage()}
      >
        <Settings className="size-4" />
      </Button>
    </header>
    <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
  </main>
);

const ConnectionPicker = ({
  connections,
  connection,
}: {
  connections: ReadonlyArray<Connection>;
  connection: Connection;
}) => {
  return (
    <div className="grid grid-cols-2 gap-2">
      <SelectField
        label="Connection"
        placeholder="Connection"
        value={connection.id}
        options={connections.map((candidate) => ({ value: candidate.id, label: candidate.label }))}
        onChange={(activeConnectionId) => persist(Storage.putSettings({ activeConnectionId }))}
      />
      <ModelPicker
        connection={connection}
        onChange={(model) => persist(Storage.saveConnection({ ...connection, model }))}
      />
    </div>
  );
};

/** Images pasted or dropped into the composer, downscaled for the model. */
const useReferences = () => {
  const [references, setReferences] = useState<ReadonlyArray<ReferenceImage>>([]);
  const [error, setError] = useState<string | null>(null);
  const add = (files: ReadonlyArray<File>) => {
    const images = files.filter((file) => file.type.startsWith("image/"));
    if (images.length === 0) return;
    setError(null);
    void Promise.all(images.map((file) => downscaleToJpeg(file, REFERENCE_MAX_EDGE))).then(
      (encoded) =>
        setReferences((current) => {
          const next = [...current, ...encoded.map((data) => ({ data }))];
          if (next.length > MAX_REFERENCE_IMAGES) {
            setError(`Up to ${MAX_REFERENCE_IMAGES} images can be attached.`);
          }
          return next.slice(0, MAX_REFERENCE_IMAGES);
        }),
      () => setError("This image could not be read."),
    );
  };
  const remove = (index: number) =>
    setReferences((current) => current.filter((_, position) => position !== index));
  const clear = () => setReferences([]);
  return { references, error, add, remove, clear };
};

// Large enough to keep detail, small enough to stay cheap; providers downscale beyond this.
const REFERENCE_MAX_EDGE = 1568;

const Composer = ({
  running,
  blocked,
  acceptsImages,
  picked,
  onPick,
  onClearPicked,
  onSubmit,
}: {
  running: boolean;
  /** Why the prompt cannot be sent yet, if anything stops it. */
  blocked: string | null;
  acceptsImages: boolean;
  picked: PickedElement | null;
  onPick: () => void;
  onClearPicked: () => void;
  onSubmit: (prompt: string, references: ReadonlyArray<ReferenceImage>) => void;
}) => {
  const [prompt, setPrompt] = useState("");
  const attachments = useReferences();
  const reason =
    blocked ??
    (!acceptsImages && attachments.references.length > 0
      ? "This connection does not accept images. Remove them or turn images on in settings."
      : null);
  const submit = () => {
    const trimmed = prompt.trim();
    if (!trimmed || running || reason) return;
    onSubmit(trimmed, attachments.references);
    setPrompt("");
    attachments.clear();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      submit();
    }
  };
  return (
    <div
      className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-zinc-50 p-2 focus-within:border-fuchsia-400 dark:border-zinc-800 dark:bg-zinc-900"
      onPaste={(event: ClipboardEvent<HTMLDivElement>) =>
        attachments.add(Array.from(event.clipboardData.files))
      }
      onDragOver={(event: DragEvent<HTMLDivElement>) => event.preventDefault()}
      onDrop={(event: DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        attachments.add(Array.from(event.dataTransfer.files));
      }}
    >
      {picked && (
        <div className="flex items-center gap-1.5 self-start rounded-md bg-fuchsia-100 py-0.5 pr-1 pl-2 text-[12px] text-fuchsia-900 dark:bg-fuchsia-950 dark:text-fuchsia-200">
          <Crosshair className="size-3" />
          <span className="max-w-64 truncate" title={picked.selector}>
            {picked.description}
          </span>
          <button
            type="button"
            aria-label="Clear the selected element"
            className="rounded p-0.5 hover:bg-fuchsia-200 dark:hover:bg-fuchsia-900"
            onClick={onClearPicked}
          >
            <X className="size-3" />
          </button>
        </div>
      )}
      {attachments.references.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Attached images">
          {attachments.references.map((reference, index) => (
            <li key={reference.data.slice(-24) + index} className="relative">
              <img
                src={`data:image/jpeg;base64,${reference.data}`}
                alt={`Attached image ${index + 1}`}
                className="size-12 rounded-md border border-zinc-200 object-cover dark:border-zinc-700"
              />
              <button
                type="button"
                aria-label={`Remove attached image ${index + 1}`}
                className="absolute -top-1.5 -right-1.5 flex size-4 items-center justify-center rounded-full bg-zinc-900 text-white shadow hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900"
                onClick={() => attachments.remove(index)}
              >
                <X className="size-2.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <textarea
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        onKeyDown={onKeyDown}
        rows={3}
        autoFocus
        placeholder={
          picked
            ? "What should change about this element?"
            : "Describe the new look, e.g. “calm dark theme with a serif headline”. Paste an image to show it."
        }
        className="w-full resize-none bg-transparent px-1 text-[13px] leading-relaxed outline-none placeholder:text-zinc-400"
      />
      <div className="flex items-center justify-between gap-2">
        <Button
          variant="ghost"
          className="h-7 px-2"
          onClick={onPick}
          title="Pick an element on the page"
        >
          <Crosshair className="size-3.5" />
          Pick element
        </Button>
        <Button
          variant="primary"
          className="h-7"
          disabled={running || reason !== null || !prompt.trim()}
          title={reason ?? undefined}
          onClick={submit}
        >
          <Sparkles className="size-3.5" />
          Restyle
          <kbd className="ml-1 font-sans text-[11px] opacity-70">⌘↵</kbd>
        </Button>
      </div>
      {(reason ?? attachments.error) && (
        <p className="px-1 text-[11px] text-amber-700 dark:text-amber-300">
          {reason ?? attachments.error}
        </p>
      )}
    </div>
  );
};

const useElapsed = (since: number | null) => {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (since === null) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [since]);
  return since === null ? 0 : Math.max(0, Math.round((now - since) / 1000));
};

const StatusLine = ({ status, onCancel }: { status: RestyleStatus; onCancel: () => void }) => {
  const elapsed = useElapsed(status._tag === "Running" ? status.startedAt : null);
  switch (status._tag) {
    case "Running":
      return (
        <div className="flex items-center gap-2 rounded-lg bg-fuchsia-50 px-3 py-2 text-[12px] text-fuchsia-900 dark:bg-fuchsia-950/50 dark:text-fuchsia-200">
          <LoaderCircle className="size-3.5 shrink-0 animate-spin" />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate font-medium">
              {status.activity}… {elapsed}s
            </span>
            <span className="truncate opacity-75">You can close this popup.</span>
          </span>
          <button
            type="button"
            className="font-medium underline underline-offset-2"
            onClick={onCancel}
          >
            Cancel
          </button>
        </div>
      );
    case "Failed":
      return <Notice tone="error">{status.message}</Notice>;
    case "Done":
      return (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-[12px] leading-snug text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200">
          {status.summary}
        </p>
      );
  }
};

const History = ({
  style,
  scriptsAvailable,
  onRestore,
}: {
  style: SiteStyle;
  scriptsAvailable: boolean;
  onRestore: (revisionId: string) => void;
}) => (
  <section className="flex flex-col gap-1.5">
    <h2 className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-500 uppercase">
      <HistoryIcon className="size-3" />
      History
    </h2>
    <ol className="flex flex-col gap-1">
      {[...style.revisions].reverse().map((revision) => {
        const current = revision.id === style.currentRevisionId;
        return (
          <li
            key={revision.id}
            className={cn(
              "rounded-lg border px-2.5 py-2",
              current
                ? "border-fuchsia-300 bg-fuchsia-50/60 dark:border-fuchsia-900 dark:bg-fuchsia-950/30"
                : "border-zinc-200 dark:border-zinc-800",
            )}
          >
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 text-[12px] font-medium">{revision.prompt}</p>
                <p className="mt-0.5 line-clamp-2 text-[12px] text-zinc-600 dark:text-zinc-400">
                  {revision.summary}
                </p>
                <p className="mt-1 text-[11px] text-zinc-400">
                  {relativeTime(revision.createdAt)} · {revision.model}
                  {revision.script && !scriptsAvailable && " · script paused"}
                </p>
              </div>
              {current ? (
                <span className="shrink-0 rounded bg-fuchsia-600 px-1.5 py-0.5 text-[10px] font-medium text-white">
                  {style.enabled ? "Current" : "Off"}
                </span>
              ) : (
                <Button
                  variant="secondary"
                  className="h-6 shrink-0 px-2 text-[12px]"
                  onClick={() => onRestore(revision.id)}
                >
                  Restore
                </Button>
              )}
            </div>
            {(revision.css || revision.script) && (
              <details className="mt-1.5 text-[12px]">
                <summary className="cursor-pointer text-zinc-500 select-none hover:text-zinc-700 dark:hover:text-zinc-300">
                  Code
                </summary>
                <div className="mt-1.5 flex flex-col gap-2">
                  <Code label="CSS" code={revision.css} />
                  <Code label="Page Script" code={revision.script} />
                </div>
              </details>
            )}
          </li>
        );
      })}
    </ol>
  </section>
);
