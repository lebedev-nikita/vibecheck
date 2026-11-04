import { Combobox } from "@base-ui/react/combobox";
import { Check, ChevronsUpDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Connection, ModelInfo } from "../domain/Connection.ts";
import { ModelList } from "../domain/Messages.ts";
import { errorMessage, sendFor } from "./client.ts";
import { cn } from "./components.tsx";

type Models =
  | { readonly _tag: "Loading" }
  | { readonly _tag: "Loaded"; readonly models: ReadonlyArray<ModelInfo> }
  | { readonly _tag: "Failed"; readonly message: string };

/** The provider's models; reloaded when the connection changes, not when its model does. */
const useModels = (connection: Connection): Models => {
  const [models, setModels] = useState<Models>({ _tag: "Loading" });
  const latest = useRef(connection);
  latest.current = connection;
  useEffect(() => {
    let active = true;
    setModels({ _tag: "Loading" });
    sendFor(ModelList, { _tag: "ListModels", connection: latest.current }).then(
      (loaded) => active && setModels({ _tag: "Loaded", models: loaded }),
      (cause: unknown) => active && setModels({ _tag: "Failed", message: errorMessage(cause) }),
    );
    return () => {
      active = false;
    };
  }, [connection.id]);
  return models;
};

const placeholder = (models: Models) => {
  switch (models._tag) {
    case "Loading":
      return "Loading models…";
    case "Failed":
      return "Models unavailable";
    case "Loaded":
      return models.models.length > 0 ? "Choose a model" : "No models listed";
  }
};

/** Matches a model when the query appears anywhere in its id or name. */
const matches = (model: ModelInfo, query: string) => {
  const needle = query.trim().toLowerCase();
  return (
    needle === "" ||
    model.id.toLowerCase().includes(needle) ||
    model.label.toLowerCase().includes(needle)
  );
};

/**
 * Picks a connection's model from the list its provider reports. Typing part
 * of a name filters the list.
 */
export const ModelPicker = ({
  connection,
  onChange,
  className,
}: {
  connection: Connection;
  onChange: (model: string) => void;
  className?: string;
}) => {
  const models = useModels(connection);
  const listed = models._tag === "Loaded" ? models.models : [];
  // A model typed by hand or retired by the provider still shows as chosen.
  const options =
    connection.model && !listed.some((model) => model.id === connection.model)
      ? [{ id: connection.model, label: connection.model }, ...listed]
      : listed;
  const selected = options.find((model) => model.id === connection.model) ?? null;
  return (
    <Combobox.Root
      items={options}
      value={selected}
      onValueChange={(model) => {
        if (model) onChange(model.id);
      }}
      itemToStringLabel={(model) => model.label}
      itemToStringValue={(model) => model.id}
      isItemEqualToValue={(item, value) => item.id === value.id}
      filter={matches}
      autoHighlight
    >
      <Combobox.InputGroup
        className={cn(
          "relative flex h-8 min-w-0 items-center rounded-md border border-zinc-200 bg-white text-[13px] text-zinc-900 focus-within:ring-2 focus-within:ring-fuchsia-500/60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100",
          className,
        )}
      >
        <Combobox.Input
          aria-label="Model"
          placeholder={placeholder(models)}
          className="h-full w-full min-w-0 rounded-md bg-transparent pr-7 pl-2.5 outline-none placeholder:text-zinc-400"
        />
        <Combobox.Trigger
          aria-label="Show models"
          className="absolute right-0 flex h-full w-7 items-center justify-center text-zinc-400"
        >
          <ChevronsUpDown className="size-3.5" />
        </Combobox.Trigger>
      </Combobox.InputGroup>
      <Combobox.Portal>
        <Combobox.Positioner className="z-50 outline-none" sideOffset={4}>
          <Combobox.Popup className="w-[var(--anchor-width)] max-w-[var(--available-width)] min-w-48 rounded-lg border border-zinc-200 bg-white p-1 text-[13px] text-zinc-900 shadow-lg outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100">
            <Combobox.Empty>
              <p className="px-2 py-1.5 text-zinc-500">No matching models</p>
            </Combobox.Empty>
            <Combobox.List className="max-h-[min(18rem,var(--available-height))] overflow-y-auto overscroll-contain outline-none">
              {(model: ModelInfo) => (
                <Combobox.Item
                  key={model.id}
                  value={model}
                  className="grid cursor-default grid-cols-[1rem_1fr] items-center gap-1.5 rounded-md py-1.5 pr-3 pl-1.5 outline-none select-none data-highlighted:bg-zinc-100 dark:data-highlighted:bg-zinc-800"
                >
                  <Combobox.ItemIndicator className="col-start-1 text-fuchsia-600">
                    <Check className="size-3.5" />
                  </Combobox.ItemIndicator>
                  <span className="col-start-2 truncate">{model.label}</span>
                </Combobox.Item>
              )}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
};
