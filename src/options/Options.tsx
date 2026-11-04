import { AlertDialog } from "@base-ui/react/alert-dialog";
import { Effect } from "effect";
import { Download, LogIn, LogOut, Plus, Trash2, Upload } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import {
  type Connection,
  type ConnectionKind,
  DEFAULT_ANTHROPIC_MODEL,
  normalizeBaseUrl,
  providerName,
  SIGN_IN_RESULT_KEY,
  SignInResult,
} from "../domain/Connection.ts";
import { decodeExchangeFile, type ExchangeFile, toExchangeFile } from "../domain/Exchange.ts";
import { ModelList } from "../domain/Messages.ts";
import { currentRevision, originPattern, type SiteStyle } from "../domain/SiteStyle.ts";
import * as Storage from "../shared/storage.ts";
import {
  errorMessage,
  openUserScriptsSettings,
  send,
  sendFor,
  useAttempt,
  useStored,
  useUserScriptsAvailable,
} from "../ui/client.ts";
import { Button, Code, Notice, type Option, SelectField, Toggle } from "../ui/components.tsx";
import { ModelPicker } from "../ui/ModelPicker.tsx";

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);

export const Options = () => {
  const scriptsAvailable = useUserScriptsAvailable();
  return (
    <main className="min-h-screen bg-zinc-50 font-sans text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <div className="mx-auto flex max-w-2xl flex-col gap-8 px-6 py-10">
        <header className="flex items-center gap-3">
          <img src="/icons/48.png" alt="" className="size-9 rounded-lg" />
          <div>
            <h1 className="text-lg font-semibold">vibecheck settings</h1>
            <p className="text-[13px] text-zinc-500">Connections, saved Site Styles and privacy.</p>
          </div>
        </header>
        {scriptsAvailable === false && (
          <Notice
            action={
              <button
                type="button"
                className="font-medium underline underline-offset-2"
                onClick={openUserScriptsSettings}
              >
                Open extension settings
              </button>
            }
          >
            Page Scripts are off. Turn on “Allow User Scripts” for vibecheck so Site Styles can move
            and rewrite elements, not only change CSS.
          </Notice>
        )}
        <Connections />
        <Sites />
        <Privacy />
      </div>
    </main>
  );
};

const Section = ({
  title,
  description,
  children,
  actions,
}: {
  title: string;
  description: string;
  children: ReactNode;
  actions?: ReactNode;
}) => (
  <section id={title.toLowerCase().replaceAll(" ", "-")} className="flex flex-col gap-3">
    <div className="flex items-end justify-between gap-4">
      <div>
        <h2 className="text-[15px] font-semibold">{title}</h2>
        <p className="text-[13px] text-zinc-500">{description}</p>
      </div>
      {actions && <div className="flex shrink-0 gap-2">{actions}</div>}
    </div>
    {children}
  </section>
);

const Card = ({ children }: { children: ReactNode }) => (
  <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-xs dark:border-zinc-800 dark:bg-zinc-900">
    {children}
  </div>
);

const inputClass =
  "h-8 w-full rounded-md border border-zinc-200 bg-white px-2.5 text-[13px] outline-none placeholder:text-zinc-400 focus:border-fuchsia-400 focus:ring-2 focus:ring-fuchsia-500/20 dark:border-zinc-700 dark:bg-zinc-950";

const Field = ({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}) => (
  <label className="flex flex-col gap-1">
    <span className="text-[12px] font-medium text-zinc-700 dark:text-zinc-300">{label}</span>
    {children}
    {hint && <span className="text-[11px] text-zinc-500">{hint}</span>}
  </label>
);

/** Asks for `webNavigation`, which catches the sign-in redirect, then starts Sign in with ChatGPT. */
const signInWithChatGPT = (connectionId: string | null) =>
  chrome.permissions.request({ permissions: ["webNavigation"] }).then((granted) => {
    if (!granted) throw new Error("vibecheck needs this permission to finish the ChatGPT sign-in.");
    return send({ _tag: "ChatGPTSignIn", connectionId });
  });

const Connections = () => {
  const connections = useStored("local", "connections", Storage.getConnections);
  const settings = useStored("local", "settings", Storage.getSettings);
  const signIn = useStored(
    "session",
    SIGN_IN_RESULT_KEY,
    Storage.readSession(SIGN_IN_RESULT_KEY, SignInResult),
  );
  const [error, attempt] = useAttempt();

  return (
    <Section
      title="Connections"
      description="The AI providers vibecheck can use. Requests go straight from this browser to them."
    >
      {signIn?._tag === "SignedIn" && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-[13px] text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200">
          Signed in to ChatGPT{signIn.email && ` as ${signIn.email}`}.
        </p>
      )}
      {signIn?._tag === "SignInFailed" && <Notice tone="error">{signIn.message}</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
      {connections?.map((connection) => (
        <ConnectionCard
          key={connection.id}
          connection={connection}
          isDefault={(settings?.activeConnectionId ?? connections[0]?.id) === connection.id}
          onAttempt={attempt}
        />
      ))}
      <AddConnection onAttempt={attempt} />
    </Section>
  );
};

const ConnectionCard = ({
  connection,
  isDefault,
  onAttempt,
}: {
  connection: Connection;
  isDefault: boolean;
  onAttempt: (action: () => Promise<unknown>) => void;
}) => {
  const signedOut = connection._tag === "chatgpt" && !connection.account.refreshToken;
  return (
    <Card>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[14px] font-medium">{connection.label}</span>
            {isDefault && (
              <span className="rounded bg-fuchsia-100 px-1.5 py-0.5 text-[10px] font-medium text-fuchsia-800 dark:bg-fuchsia-950 dark:text-fuchsia-200">
                Default
              </span>
            )}
          </div>
          <p className="text-[12px] text-zinc-500">
            {providerName(connection._tag)}
            {connection._tag === "openai-compatible" && ` · ${connection.baseUrl}`}
            {signedOut && " · signed out"}
          </p>
        </div>
        <div className="flex shrink-0 gap-1">
          {!isDefault && (
            <Button
              variant="ghost"
              onClick={() =>
                onAttempt(() => run(Storage.putSettings({ activeConnectionId: connection.id })))
              }
            >
              Make default
            </Button>
          )}
          {connection._tag === "chatgpt" &&
            (signedOut ? (
              <Button
                variant="secondary"
                onClick={() => onAttempt(() => signInWithChatGPT(connection.id))}
              >
                <LogIn className="size-3.5" />
                Sign in
              </Button>
            ) : (
              <Button
                variant="ghost"
                onClick={() =>
                  onAttempt(() => send({ _tag: "ChatGPTSignOut", connectionId: connection.id }))
                }
              >
                <LogOut className="size-3.5" />
                Sign out
              </Button>
            ))}
          <Button
            variant="danger"
            aria-label={`Remove ${connection.label}`}
            onClick={() => onAttempt(() => run(Storage.deleteConnection(connection.id)))}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </div>
      <ModelSetting
        connection={connection}
        onChange={(model) => onAttempt(() => run(Storage.saveConnection({ ...connection, model })))}
      />
    </Card>
  );
};

/** The model a connection restyles with: from the provider's list, or typed by hand. */
const ModelSetting = ({
  connection,
  onChange,
}: {
  connection: Connection;
  onChange: (model: string) => void;
}) => {
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState(connection.model);
  const commit = () => {
    const next = typed.trim();
    setTyping(false);
    if (next && next !== connection.model) onChange(next);
  };
  return (
    <div className="mt-3 flex flex-col gap-1">
      <span className="text-[12px] font-medium text-zinc-700 dark:text-zinc-300">Model</span>
      {typing ? (
        <input
          className={inputClass}
          aria-label="Model id"
          autoFocus
          value={typed}
          placeholder="Model id"
          onChange={(event) => setTyped(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => event.key === "Enter" && commit()}
        />
      ) : (
        <ModelPicker connection={connection} onChange={onChange} className="w-full" />
      )}
      <span className="text-[11px] text-zinc-500">
        {connection.model
          ? "You can also change it in the popup. "
          : "Choose one before restyling. "}
        <button
          type="button"
          className="underline underline-offset-2 hover:text-zinc-700 dark:hover:text-zinc-300"
          onClick={() => {
            setTyped(connection.model);
            setTyping(!typing);
          }}
        >
          {typing ? "Pick from the list" : "Enter a model id"}
        </button>
      </span>
    </div>
  );
};

const KINDS: ReadonlyArray<Option & { readonly value: ConnectionKind }> = [
  { value: "anthropic", label: "Anthropic (API key)" },
  { value: "openai", label: "OpenAI (API key)" },
  { value: "chatgpt", label: "ChatGPT (subscription)" },
  { value: "openai-compatible", label: "OpenAI-compatible (OpenRouter, Ollama, …)" },
];

type KeyKind = Exclude<ConnectionKind, "chatgpt">;

interface Draft {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly label: string;
  readonly model: string;
  readonly vision: boolean;
}

const EMPTY_DRAFT: Draft = { apiKey: "", baseUrl: "", label: "", model: "", vision: true };

const KEY_HINTS: Record<KeyKind, string | null> = {
  anthropic:
    "Create one at console.anthropic.com. Claude subscriptions cannot be used by other apps.",
  openai: "Create one at platform.openai.com.",
  "openai-compatible": null,
};

/** The connection a filled-in form describes, or null while it is incomplete. */
const draftConnection = (kind: KeyKind, draft: Draft): Connection | null => {
  const id = crypto.randomUUID();
  const apiKey = draft.apiKey.trim();
  if (kind !== "openai-compatible") {
    if (!apiKey) return null;
    return { _tag: kind, id, label: draft.label || providerName(kind), model: "", apiKey };
  }
  const baseUrl = normalizeBaseUrl(draft.baseUrl);
  if (!baseUrl) return null;
  return {
    _tag: kind,
    id,
    label: draft.label || new URL(baseUrl).host,
    model: draft.model.trim(),
    baseUrl,
    apiKey,
    vision: draft.vision,
  };
};

/**
 * Checks the credentials by listing models, then saves. The model is left for
 * the user to choose, except Anthropic's, which has a sensible default.
 */
const verifyAndSave = async (connection: Connection) => {
  const models = await sendFor(ModelList, { _tag: "ListModels", connection }).catch(
    (cause: unknown) => {
      // Some compatible servers have no model list; a typed model is enough.
      if (connection._tag === "openai-compatible" && connection.model) return [];
      throw new Error(`Could not connect: ${errorMessage(cause)}`);
    },
  );
  const preferred =
    connection._tag === "anthropic"
      ? models.find((candidate) => candidate.id === DEFAULT_ANTHROPIC_MODEL)
      : undefined;
  const model = connection.model || preferred?.id || "";
  await run(Storage.saveConnection({ ...connection, model }));
};

const AddConnection = ({ onAttempt }: { onAttempt: (action: () => Promise<unknown>) => void }) => {
  const [kind, setKind] = useState<ConnectionKind>("anthropic");
  return (
    <Card>
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2 text-[14px] font-medium">
          <Plus className="size-4" />
          Add a connection
        </div>
        <Field label="Provider">
          <SelectField
            label="Provider"
            placeholder="Provider"
            value={kind}
            options={KINDS}
            onChange={(value) => setKind(value as ConnectionKind)}
          />
        </Field>
        {kind === "chatgpt" ? (
          <ChatGPTSignIn onAttempt={onAttempt} />
        ) : (
          <KeyConnectionForm key={kind} kind={kind} onAttempt={onAttempt} />
        )}
      </div>
    </Card>
  );
};

const ChatGPTSignIn = ({ onAttempt }: { onAttempt: (action: () => Promise<unknown>) => void }) => (
  <div className="flex flex-col items-start gap-2">
    <p className="text-[12px] text-zinc-500">
      Uses your ChatGPT plan through OpenAI’s official Sign in with ChatGPT. Usage counts toward
      your plan’s limits; you can review it in ChatGPT Settings → Usage.
    </p>
    <Button variant="primary" onClick={() => onAttempt(() => signInWithChatGPT(null))}>
      Continue with ChatGPT
    </Button>
  </div>
);

const KeyConnectionForm = ({
  kind,
  onAttempt,
}: {
  kind: KeyKind;
  onAttempt: (action: () => Promise<unknown>) => void;
}) => {
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const compatible = kind === "openai-compatible";
  const connection = draftConnection(kind, draft);
  const update = (field: keyof Draft) => (event: { target: { value: string } }) =>
    setDraft({ ...draft, [field]: event.target.value });

  const save = () => {
    if (!connection) return;
    // Custom endpoints need host access, asked for inside this click.
    const access =
      connection._tag === "openai-compatible"
        ? chrome.permissions.request({
            origins: [originPattern(new URL(connection.baseUrl).origin)],
          })
        : Promise.resolve(true);
    setSaving(true);
    onAttempt(async () => {
      try {
        if (!(await access)) throw new Error("vibecheck needs access to this endpoint to call it.");
        await verifyAndSave(connection);
        setDraft(EMPTY_DRAFT);
      } finally {
        setSaving(false);
      }
    });
  };

  return (
    <>
      {compatible && (
        <Field
          label="Base URL"
          hint="For example https://openrouter.ai/api/v1 or http://localhost:11434. A URL without a path gets /v1."
        >
          <input
            className={inputClass}
            value={draft.baseUrl}
            onChange={update("baseUrl")}
            placeholder="http://localhost:11434"
          />
        </Field>
      )}
      <Field label={compatible ? "API key (optional)" : "API key"} hint={KEY_HINTS[kind]}>
        <input
          className={inputClass}
          type="password"
          autoComplete="off"
          value={draft.apiKey}
          onChange={update("apiKey")}
        />
      </Field>
      {compatible && (
        <>
          <Field
            label="Model (optional)"
            hint="Leave empty to choose from the server's list after saving."
          >
            <input className={inputClass} value={draft.model} onChange={update("model")} />
          </Field>
          <label className="flex items-center gap-2 text-[13px]">
            <Toggle
              label="The model accepts images"
              checked={draft.vision}
              onChange={(vision) => setDraft({ ...draft, vision })}
            />
            The model accepts images (send screenshots)
          </label>
        </>
      )}
      <Field label="Name (optional)">
        <input
          className={inputClass}
          value={draft.label}
          onChange={update("label")}
          placeholder={providerName(kind)}
        />
      </Field>
      <div>
        <Button variant="primary" disabled={saving || connection === null} onClick={save}>
          {saving ? "Checking…" : "Save connection"}
        </Button>
      </div>
    </>
  );
};

/** All stored Site Styles, following changes to any of them. */
const useSiteStyles = () => {
  const [styles, setStyles] = useState<ReadonlyArray<SiteStyle>>([]);
  useEffect(() => {
    const refresh = () => void run(Storage.listSiteStyles).then(setStyles, () => undefined);
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>) => {
      if (Object.keys(changes).some((key) => key.startsWith("site:"))) refresh();
    };
    refresh();
    chrome.storage.local.onChanged.addListener(onChanged);
    return () => chrome.storage.local.onChanged.removeListener(onChanged);
  }, []);
  return styles;
};

const download = (file: ExchangeFile) => {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(file, null, 2)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `vibecheck-site-styles-${file.exportedAt.slice(0, 10)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const Sites = () => {
  const styles = useSiteStyles();
  const [error, attempt] = useAttempt();
  const [pending, setPending] = useState<ExchangeFile | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const readFile = (file: File) =>
    attempt(async () => {
      const decoded = await run(
        decodeExchangeFile(await file.text()).pipe(
          Effect.mapError(() => new Error("This file is not a vibecheck export.")),
        ),
      );
      if (decoded.sites.length === 0) throw new Error("This file has no Site Styles.");
      setPending(decoded);
    });

  const confirmImport = (file: ExchangeFile) => {
    // Host access lets imported Site Styles apply on their own, asked inside this click.
    const access = chrome.permissions.request({
      origins: file.sites.map((site) => originPattern(site.origin)),
    });
    setPending(null);
    attempt(async () => {
      await access.catch(() => false);
      await send({ _tag: "ImportSites", sites: file.sites });
    });
  };

  return (
    <Section
      title="Site Styles"
      description="Each site keeps its last 20 Revisions. Export shares the current Revision of each site."
      actions={
        <>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) readFile(file);
            }}
          />
          <Button onClick={() => fileInput.current?.click()}>
            <Upload className="size-3.5" />
            Import
          </Button>
          <Button
            disabled={styles.length === 0}
            onClick={() => download(toExchangeFile(styles, new Date()))}
          >
            <Download className="size-3.5" />
            Export all
          </Button>
        </>
      }
    >
      {error && <Notice tone="error">{error}</Notice>}
      {styles.length === 0 ? (
        <p className="rounded-xl border border-dashed border-zinc-300 px-4 py-6 text-center text-[13px] text-zinc-500 dark:border-zinc-700">
          No Site Styles yet. Open a site, click the vibecheck icon and describe a change.
        </p>
      ) : (
        <Card>
          <ul className="flex flex-col divide-y divide-zinc-100 dark:divide-zinc-800">
            {styles.map((style) => (
              <li
                key={style.origin}
                className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0"
              >
                <Toggle
                  label={`Apply the Site Style on ${style.origin}`}
                  checked={style.enabled}
                  onChange={(enabled) =>
                    attempt(() =>
                      send({ _tag: "SetEnabled", tabId: null, origin: style.origin, enabled }),
                    )
                  }
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium">{new URL(style.origin).host}</p>
                  <p className="truncate text-[12px] text-zinc-500">
                    {currentRevision(style)?.summary ?? "No Revision selected"} ·{" "}
                    {style.revisions.length}{" "}
                    {style.revisions.length === 1 ? "Revision" : "Revisions"}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  aria-label={`Export ${style.origin}`}
                  onClick={() => download(toExchangeFile([style], new Date()))}
                >
                  <Download className="size-3.5" />
                </Button>
                <Button
                  variant="danger"
                  aria-label={`Delete the Site Style of ${style.origin}`}
                  onClick={() =>
                    attempt(() => send({ _tag: "DeleteSiteStyle", origin: style.origin }))
                  }
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <ImportDialog file={pending} onCancel={() => setPending(null)} onConfirm={confirmImport} />
    </Section>
  );
};

const ImportDialog = ({
  file,
  onCancel,
  onConfirm,
}: {
  file: ExchangeFile | null;
  onCancel: () => void;
  onConfirm: (file: ExchangeFile) => void;
}) => (
  <AlertDialog.Root open={file !== null} onOpenChange={(open) => !open && onCancel()}>
    <AlertDialog.Portal>
      <AlertDialog.Backdrop className="fixed inset-0 bg-black/30 transition-opacity data-ending-style:opacity-0 data-starting-style:opacity-0" />
      <AlertDialog.Popup className="fixed top-1/2 left-1/2 flex max-h-[85vh] w-[36rem] max-w-[calc(100vw-2rem)] -translate-1/2 flex-col gap-4 rounded-xl border border-zinc-200 bg-white p-5 shadow-xl dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex flex-col gap-1">
          <AlertDialog.Title className="text-[15px] font-semibold">
            Import {file?.sites.length} Site Styles?
          </AlertDialog.Title>
          <AlertDialog.Description className="text-[13px] text-zinc-600 dark:text-zinc-400">
            This file contains executable code. Page Scripts run on the listed sites with access to
            their content. Import only files from people you trust. Each import becomes a new
            Revision; your history stays.
          </AlertDialog.Description>
        </div>
        <ul className="flex min-h-0 flex-col gap-3 overflow-y-auto">
          {file?.sites.map((site) => (
            <li
              key={site.origin}
              className="flex flex-col gap-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800"
            >
              <p className="text-[13px] font-medium">{site.origin}</p>
              {site.summary && <p className="text-[12px] text-zinc-500">{site.summary}</p>}
              <Code label="CSS" code={site.css} />
              <Code label="Page Script" code={site.script} />
            </li>
          ))}
        </ul>
        <div className="flex justify-end gap-2">
          <AlertDialog.Close render={<Button />}>Cancel</AlertDialog.Close>
          <Button variant="primary" onClick={() => file && onConfirm(file)}>
            Import and apply
          </Button>
        </div>
      </AlertDialog.Popup>
    </AlertDialog.Portal>
  </AlertDialog.Root>
);

const Privacy = () => (
  <Section title="Privacy" description="vibecheck has no server and collects nothing.">
    <Card>
      <ul className="flex list-disc flex-col gap-1.5 pl-4 text-[13px] leading-relaxed text-zinc-700 dark:text-zinc-300">
        <li>
          When you restyle a page, its URL and title, an outline of its structure, the element you
          picked, the current Site Style, a screenshot of the visible area and any images you
          attached go directly from this browser to the provider of the connection you chose.
        </li>
        <li>
          API keys, ChatGPT sign-in tokens and Site Styles are stored only in this browser’s
          extension storage.
        </li>
        <li>Page Scripts run without network access, so they cannot send page content anywhere.</li>
      </ul>
    </Card>
  </Section>
);
