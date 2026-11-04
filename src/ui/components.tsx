import { Select } from "@base-ui/react/select";
import { Switch } from "@base-ui/react/switch";
import { Check, ChevronsUpDown, TriangleAlert } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

export const cn = (...classes: Array<string | false | null | undefined>) =>
  classes.filter(Boolean).join(" ");

type Variant = "primary" | "secondary" | "ghost" | "danger";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-fuchsia-600 text-white shadow-sm hover:bg-fuchsia-700 disabled:bg-fuchsia-600/50 dark:disabled:bg-fuchsia-600/40",
  secondary:
    "border border-zinc-200 bg-white text-zinc-900 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800",
  ghost:
    "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100",
  danger: "text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950",
};

export const Button = ({
  variant = "secondary",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) => (
  <button
    type="button"
    className={cn(
      "inline-flex h-8 items-center justify-center gap-1.5 rounded-md px-3 text-[13px] font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-500/60 disabled:cursor-not-allowed",
      VARIANTS[variant],
      className,
    )}
    {...props}
  />
);

export const Toggle = ({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) => (
  <Switch.Root
    checked={checked}
    onCheckedChange={(next) => onChange(next)}
    aria-label={label}
    className="relative flex h-5 w-9 shrink-0 rounded-full bg-zinc-300 p-0.5 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-500/60 data-checked:bg-fuchsia-600 dark:bg-zinc-700"
  >
    <Switch.Thumb className="size-4 rounded-full bg-white shadow transition-transform data-checked:translate-x-4" />
  </Switch.Root>
);

export interface Option {
  readonly value: string;
  readonly label: string;
}

export const SelectField = ({
  value,
  options,
  onChange,
  placeholder,
  label,
  className,
}: {
  value: string | null;
  options: ReadonlyArray<Option>;
  onChange: (value: string) => void;
  placeholder: string;
  label: string;
  className?: string;
}) => (
  <Select.Root
    items={options}
    value={value}
    onValueChange={(next) => {
      if (typeof next === "string") onChange(next);
    }}
  >
    <Select.Trigger
      aria-label={label}
      className={cn(
        "flex h-8 min-w-0 items-center justify-between gap-2 rounded-md border border-zinc-200 bg-white px-2.5 text-[13px] text-zinc-900 outline-none hover:bg-zinc-50 focus-visible:ring-2 focus-visible:ring-fuchsia-500/60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800",
        className,
      )}
    >
      <Select.Value className="truncate data-placeholder:text-zinc-400" placeholder={placeholder} />
      <Select.Icon className="shrink-0 text-zinc-400">
        <ChevronsUpDown className="size-3.5" />
      </Select.Icon>
    </Select.Trigger>
    <Select.Portal>
      <Select.Positioner className="z-50 outline-none" sideOffset={4} alignItemWithTrigger={false}>
        <Select.Popup className="max-h-[var(--available-height)] min-w-[var(--anchor-width)] overflow-y-auto rounded-lg border border-zinc-200 bg-white p-1 text-[13px] text-zinc-900 shadow-lg outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100">
          <Select.List>
            {options.map((option) => (
              <Select.Item
                key={option.value}
                value={option.value}
                className="grid cursor-default grid-cols-[1rem_1fr] items-center gap-1.5 rounded-md py-1.5 pr-3 pl-1.5 outline-none select-none data-highlighted:bg-zinc-100 dark:data-highlighted:bg-zinc-800"
              >
                <Select.ItemIndicator className="col-start-1 text-fuchsia-600">
                  <Check className="size-3.5" />
                </Select.ItemIndicator>
                <Select.ItemText className="col-start-2 truncate">{option.label}</Select.ItemText>
              </Select.Item>
            ))}
          </Select.List>
        </Select.Popup>
      </Select.Positioner>
    </Select.Portal>
  </Select.Root>
);

export const Notice = ({
  tone = "warning",
  children,
  action,
}: {
  tone?: "warning" | "error";
  children: ReactNode;
  action?: ReactNode;
}) => (
  <div
    role={tone === "error" ? "alert" : "status"}
    className={cn(
      "flex items-start gap-2 rounded-lg border px-3 py-2 text-[12px] leading-snug",
      tone === "warning" &&
        "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200",
      tone === "error" &&
        "border-red-200 bg-red-50 text-red-900 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200",
    )}
  >
    <TriangleAlert className="mt-px size-3.5 shrink-0" />
    <div className="min-w-0 flex-1">{children}</div>
    {action}
  </div>
);

export const Code = ({ label, code }: { label: string; code: string }) =>
  code ? (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-medium text-zinc-500 uppercase">{label}</span>
      <pre className="max-h-48 overflow-auto rounded-md bg-zinc-100 p-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-zinc-800 dark:bg-zinc-800/70 dark:text-zinc-200">
        {code}
      </pre>
    </div>
  ) : null;
