import { useEffect, useMemo, useState } from "react";
import Icon from "@mdi/react";

import type { ControlDescriptor, Device } from "../types";
import { controlIconPath, iconOnlyInCompact } from "./controlIcons";

function optionsFor(control: ControlDescriptor, device: Device) {
  if (control.options?.length) return control.options;
  if (control.options_from_state) {
    const value = device.state?.[control.options_from_state];
    if (Array.isArray(value)) {
      return value.map((item: any) =>
        typeof item === "string" ? { value: item, label: item } : item,
      );
    }
  }
  return [];
}

function controlState(control: ControlDescriptor, device: Device) {
  const key = control.state_key || control.parameter || control.action;
  return device.state?.[key];
}

function isEnabled(value: unknown) {
  if (value === true || value === 1) return true;
  return ["on", "true", "yes", "enabled", "active", "muted"].includes(
    String(value ?? "").toLowerCase(),
  );
}

export default function ControlPanel({
  device,
  controls,
  onControl,
  compact = false,
}: {
  device: Device;
  controls?: ControlDescriptor[];
  onControl: (action: string, parameters?: Record<string, any>) => Promise<any>;
  compact?: boolean;
}) {
  const available = controls || device.capabilities?.controls || [];
  const groups = useMemo(
    () =>
      available.reduce<Record<string, ControlDescriptor[]>>((result, control) => {
        (result[control.group || "main"] ||= []).push(control);
        return result;
      }, {}),
    [available],
  );

  return (
    <div className="space-y-4">
      {Object.entries(groups).map(([group, items]) => (
        <div key={group}>
          {!compact && (
            <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
              {group}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {items.map((control) => (
              <One
                key={control.action}
                control={control}
                device={device}
                onControl={onControl}
                compact={compact}
              />
            ))}
          </div>
        </div>
      ))}
      {!available.length && (
        <div className="text-sm text-zinc-500">This device exposes status only.</div>
      )}
    </div>
  );
}

function One({
  control,
  device,
  onControl,
  compact,
}: {
  control: ControlDescriptor;
  device: Device;
  onControl: (action: string, parameters?: Record<string, any>) => Promise<any>;
  compact: boolean;
}) {
  const stateValue = controlState(control, device);
  const [value, setValue] = useState<any>(stateValue ?? control.min ?? "");
  const [temp, setTemp] = useState(22);
  const [busy, setBusy] = useState(false);
  const [optimisticToggle, setOptimisticToggle] = useState<boolean | null>(null);
  const iconPath = controlIconPath(control);

  useEffect(() => {
    if (stateValue !== undefined && control.type === "range") {
      setValue(stateValue);
    }
    if (stateValue !== undefined && control.type === "toggle") {
      setOptimisticToggle(null);
    }
  }, [stateValue, control.type]);

  const invoke = async (parameters?: Record<string, any>) => {
    setBusy(true);
    try {
      return await onControl(control.action, parameters);
    } finally {
      setBusy(false);
    }
  };

  const baseClass =
    "inline-flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm transition disabled:opacity-50";

  if (control.type === "range") {
    return (
      <label
        className={`${compact ? "w-36" : "w-56"} rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs text-zinc-300`}
      >
        <span className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5">
            {iconPath && <Icon path={iconPath} size={0.65} />}
            {control.label}
          </span>
          <span>{value}</span>
        </span>
        <input
          className="mt-1 w-full accent-cyan-500"
          type="range"
          min={control.min ?? 0}
          max={control.max ?? 100}
          step={control.step ?? 1}
          value={value}
          onChange={(event) => setValue(Number(event.target.value))}
          onPointerUp={() =>
            void invoke({ [control.parameter || "value"]: value })
          }
        />
      </label>
    );
  }

  if (control.type === "toggle") {
    const enabled =
      stateValue !== undefined
        ? isEnabled(stateValue)
        : optimisticToggle ?? false;
    const nextValue = !enabled;
    const title =
      control.action === "power"
        ? enabled
          ? "Turn off"
          : "Turn on"
        : control.action.includes("mute")
          ? enabled
            ? "Unmute"
            : "Mute"
          : `${nextValue ? "Enable" : "Disable"} ${control.label}`;

    return (
      <button
        type="button"
        disabled={busy}
        aria-pressed={enabled}
        title={title}
        className={`${baseClass} ${
          enabled
            ? "border-cyan-500 bg-cyan-950/60 text-cyan-200"
            : "border-zinc-700 bg-zinc-800 text-zinc-100 hover:border-cyan-500"
        }`}
        onClick={async () => {
          setOptimisticToggle(nextValue);
          try {
            await invoke({ [control.parameter || "value"]: nextValue });
          } catch (error) {
            setOptimisticToggle(null);
            throw error;
          }
        }}
      >
        {iconPath && <Icon path={iconPath} size={0.75} />}
        {!(compact && iconPath) && <span>{control.label}</span>}
        {compact && iconPath && <span className="sr-only">{control.label}</span>}
      </button>
    );
  }

  if (control.type === "select") {
    return (
      <label className="relative inline-flex items-center">
        {iconPath && (
          <span className="pointer-events-none absolute left-2.5 z-10 text-zinc-400">
            <Icon path={iconPath} size={0.65} />
          </span>
        )}
        <select
          className={`${baseClass} border-zinc-700 bg-zinc-800 text-zinc-100 hover:border-cyan-500 ${
            iconPath ? "pl-8" : ""
          }`}
          defaultValue=""
          onChange={(event) => {
            if (event.target.value) {
              void invoke({ [control.parameter || "value"]: event.target.value });
            }
          }}
        >
          <option value="">{control.label}</option>
          {optionsFor(control, device).map((option: any) => (
            <option key={option.value} value={option.value}>
              {option.label ?? option.value}
            </option>
          ))}
        </select>
      </label>
    );
  }

  if (control.type === "text" || control.type === "media_search") {
    return (
      <form
        className="flex min-w-64 flex-1 gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void invoke({ [control.parameter || "value"]: value });
        }}
      >
        <input
          className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={control.placeholder || control.label}
        />
        <button
          disabled={busy || !value}
          className={`${baseClass} border-zinc-700 bg-zinc-800 text-zinc-100 hover:border-cyan-500`}
        >
          {iconPath && <Icon path={iconPath} size={0.7} />}
          {control.type === "media_search" ? "Play" : "Send"}
        </button>
      </form>
    );
  }

  if (control.type === "number_pair") {
    return (
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-zinc-400">
          Minutes
          <input
            className="mt-1 block w-24 rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-2 text-sm"
            type="number"
            min="1"
            value={value || 30}
            onChange={(event) => setValue(Number(event.target.value))}
          />
        </label>
        <label className="text-xs text-zinc-400">
          Temperature °C
          <input
            className="mt-1 block w-28 rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-2 text-sm"
            type="number"
            min="5"
            max="35"
            step="0.5"
            value={temp}
            onChange={(event) => setTemp(Number(event.target.value))}
          />
        </label>
        <button
          className={`${baseClass} border-zinc-700 bg-zinc-800 text-zinc-100 hover:border-cyan-500`}
          disabled={busy}
          onClick={() =>
            void invoke({ minutes: Number(value || 30), temperature: temp })
          }
        >
          {iconPath && <Icon path={iconPath} size={0.7} />}
          {control.label}
        </button>
      </div>
    );
  }

  const iconOnly = compact && iconPath && iconOnlyInCompact(control);
  return (
    <button
      type="button"
      disabled={busy}
      title={control.label}
      className={`${baseClass} border-zinc-700 bg-zinc-800 text-zinc-100 hover:border-cyan-500`}
      onClick={() => void invoke()}
    >
      {iconPath && <Icon path={iconPath} size={0.75} />}
      {busy ? (
        "Working…"
      ) : iconOnly ? (
        <span className="sr-only">{control.label}</span>
      ) : (
        control.label
      )}
    </button>
  );
}
