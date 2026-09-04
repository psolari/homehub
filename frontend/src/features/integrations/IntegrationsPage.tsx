import { useEffect, useMemo, useState } from "react";
import * as mdi from "@mdi/js";
import Icon from "@mdi/react";
import { useNavigate } from "react-router-dom";

import { get, patch, post, remove } from "../../shared/api/client";
import Modal from "../../shared/components/Modal";
import type {
  IntegrationAccount,
  ProviderCatalog,
  ProviderDefinition,
} from "../../shared/types";

type FormState = Record<string, Record<string, string | number>>;
type ConnectResponse = IntegrationAccount & {
  authorization_url?: string;
  connection?: {
    message?: string;
    provider_devices_seen?: number;
  };
  discovered_devices?: unknown[];
};
type DiscoverResponse = { devices: unknown[]; count: number };

const mdiPaths = mdi as unknown as Record<string, string>;
const PROVIDER_ICONS: Record<string, string> = {
  spotify: "mdiSpotify",
  heating: "mdiRadiator",
  doorbell: "mdiDoorbellVideo",
  speaker: "mdiSpeakerWireless",
  alarm: "mdiShieldHome",
};

function providerIcon(definition: ProviderDefinition) {
  return (
    mdiPaths[PROVIDER_ICONS[definition.icon || ""] || "mdiPuzzleOutline"] ||
    mdiPaths.mdiPuzzleOutline
  );
}

function effectiveStatus(account?: IntegrationAccount) {
  if (!account) return "not_configured";
  if (
    account.status === "connected" &&
    !String(account.metadata?.verified_at || "")
  ) {
    return "needs_verification";
  }
  return account.status;
}

function statusPresentation(account?: IntegrationAccount) {
  const status = effectiveStatus(account);
  switch (status) {
    case "connected":
      return {
        label: "Connected",
        className:
          "border-emerald-900/70 bg-emerald-950/50 text-emerald-300",
        icon: mdiPaths.mdiCheckCircle,
      };
    case "needs_auth":
      return {
        label: "Authorisation needed",
        className: "border-amber-900/70 bg-amber-950/50 text-amber-300",
        icon: mdiPaths.mdiOpenInNew,
      };
    case "error":
      return {
        label: "Needs attention",
        className: "border-red-900/70 bg-red-950/50 text-red-300",
        icon: mdiPaths.mdiAlertCircle,
      };
    case "needs_verification":
      return {
        label: "Needs verification",
        className: "border-amber-900/70 bg-amber-950/50 text-amber-300",
        icon: mdiPaths.mdiShieldAlert,
      };
    default:
      return {
        label: "Not configured",
        className: "border-zinc-700 bg-zinc-800/80 text-zinc-400",
        icon: mdiPaths.mdiCloudOffOutline,
      };
  }
}

function formattedTime(value: unknown) {
  if (!value) return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export default function IntegrationsPage() {
  const navigate = useNavigate();
  const [providers, setProviders] = useState<ProviderCatalog>({});
  const [accounts, setAccounts] = useState<IntegrationAccount[]>([]);
  const [forms, setForms] = useState<FormState>({});
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [busyProvider, setBusyProvider] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = async () => {
    const [nextProviders, nextAccounts] = await Promise.all([
      get<ProviderCatalog>("/provider-catalog/"),
      get<IntegrationAccount[]>("/integration-accounts/"),
    ]);
    setProviders(nextProviders);
    setAccounts(nextAccounts);
  };

  useEffect(() => {
    void load().catch((reason: Error) => setError(reason.message));
  }, []);

  const accountFor = (provider: string) =>
    accounts.find((account) => account.provider === provider);

  const counts = useMemo(() => {
    const values = Object.keys(providers).map((provider) =>
      effectiveStatus(accountFor(provider)),
    );
    return {
      connected: values.filter((value) => value === "connected").length,
      attention: values.filter((value) =>
        ["error", "needs_auth", "needs_verification"].includes(value),
      ).length,
      available: values.filter((value) => value === "not_configured").length,
    };
  }, [providers, accounts]);

  const openProvider = (provider: string) => {
    const definition = providers[provider];
    const initial: Record<string, string | number> = {};
    for (const field of definition?.fields || []) {
      if (field.default !== undefined) initial[field.name] = field.default;
    }
    setForms((current) => ({
      ...current,
      [provider]: { ...initial, ...(current[provider] || {}) },
    }));
    setError("");
    setMessage("");
    setSelectedProvider(provider);
  };

  const saveAndConnect = async (provider: string) => {
    const definition = providers[provider];
    if (!definition) return;
    const current = accountFor(provider);
    const values = forms[provider] || {};
    const credentials: Record<string, unknown> = {};

    for (const field of definition.fields) {
      const raw =
        values[field.name] !== undefined ? values[field.name] : field.default;
      if (raw !== undefined && raw !== "") credentials[field.name] = raw;
    }

    const missing = definition.fields
      .filter((field) => !field.optional)
      .filter(
        (field) =>
          credentials[field.name] === undefined &&
          !current?.configured_credentials.includes(field.name),
      )
      .map((field) => field.label);

    if (missing.length) {
      setError(`Complete the required fields: ${missing.join(", ")}.`);
      return;
    }

    setBusyProvider(provider);
    setError("");
    setMessage("");

    try {
      const account = current
        ? await patch<IntegrationAccount>(
            `/integration-accounts/${current.id}/`,
            Object.keys(credentials).length ? { credentials } : {},
          )
        : await post<IntegrationAccount>("/integration-accounts/", {
            provider,
            name: "Default",
            credentials,
            config: {},
          });

      const result = await post<ConnectResponse>(
        `/integration-accounts/${account.id}/connect/`,
      );

      if (result.authorization_url) {
        window.open(
          result.authorization_url,
          "_blank",
          "noopener,noreferrer",
        );
        setMessage(
          "Spotify credentials were saved. Complete authorisation in the new tab, then click Refresh status here.",
        );
      } else {
        const count = result.discovered_devices?.length;
        const suffix =
          typeof count === "number" && definition.supports_device_discovery
            ? ` HomeHub found ${count} unconfigured device${count === 1 ? "" : "s"} through this account.`
            : "";
        setMessage(
          `${result.connection?.message || `${definition.display_name} connection verified.`}${suffix}`,
        );
      }

      setForms((currentForms) => ({
        ...currentForms,
        [provider]: Object.fromEntries(
          Object.entries(currentForms[provider] || {}).filter(([name]) =>
            definition.fields.some(
              (field) => field.name === name && !field.secret,
            ),
          ),
        ),
      }));
      await load();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : `${definition.display_name} connection failed.`,
      );
      await load();
    } finally {
      setBusyProvider(null);
    }
  };

  const discoverDevices = async (provider: string) => {
    const account = accountFor(provider);
    const definition = providers[provider];
    if (!account || !definition) return;

    setBusyProvider(provider);
    setError("");
    setMessage("");
    try {
      const result = await post<DiscoverResponse>(
        `/integration-accounts/${account.id}/discover/`,
      );
      setMessage(
        result.count
          ? `${definition.display_name} found ${result.count} device${result.count === 1 ? "" : "s"} ready to set up. Open Devices to continue.`
          : `${definition.display_name} is connected, but no new supported devices were found.`,
      );
      await load();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Device discovery failed.",
      );
      await load();
    } finally {
      setBusyProvider(null);
    }
  };

  const forgetIntegration = async (provider: string) => {
    const account = accountFor(provider);
    if (!account) return;
    if (
      !window.confirm(
        `Remove the ${providers[provider]?.display_name} integration and its stored credentials from HomeHub?`,
      )
    ) {
      return;
    }

    setBusyProvider(provider);
    try {
      await remove(`/integration-accounts/${account.id}/`);
      setSelectedProvider(null);
      setMessage(`${providers[provider]?.display_name} integration removed.`);
      await load();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Could not remove integration.",
      );
    } finally {
      setBusyProvider(null);
    }
  };

  const selectedDefinition = selectedProvider
    ? providers[selectedProvider]
    : null;
  const selectedAccount = selectedProvider
    ? accountFor(selectedProvider)
    : undefined;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-bold">Integrations</h1>
        <p className="mt-2 max-w-3xl text-zinc-400">
          Connect HomeHub to cloud accounts and shared services. Integrations
          unlock device discovery and features; they are not devices themselves.
        </p>
      </header>

      <div className="grid gap-3 md:grid-cols-3">
        <SummaryCard
          icon={mdiPaths.mdiCheckCircle}
          label="Verified"
          value={counts.connected}
          tone="emerald"
        />
        <SummaryCard
          icon={mdiPaths.mdiAlertCircle}
          label="Needs attention"
          value={counts.attention}
          tone="amber"
        />
        <SummaryCard
          icon={mdiPaths.mdiPuzzleOutline}
          label="Available"
          value={counts.available}
          tone="zinc"
        />
      </div>

      <div className="rounded-2xl border border-cyan-900/60 bg-cyan-950/20 p-4">
        <div className="flex gap-3">
          <Icon
            path={mdiPaths.mdiInformationOutline}
            size={0.9}
            className="mt-0.5 shrink-0 text-cyan-300"
          />
          <div>
            <div className="font-medium text-cyan-100">
              Integration account vs device
            </div>
            <p className="mt-1 max-w-4xl text-sm leading-6 text-cyan-100/65">
              Connecting Hive, Ring or Alexa proves HomeHub can access that
              account. It does not create a thermostat, camera or speaker
              automatically. Once the account is verified, HomeHub discovers
              supported devices through it; you then choose which devices to
              add from the Devices page.
            </p>
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-900 bg-red-950/40 p-3 text-sm text-red-300">
          {error}
        </div>
      )}
      {message && (
        <div className="rounded-xl border border-cyan-900 bg-cyan-950/30 p-3 text-sm text-cyan-200">
          {message}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {Object.entries(providers).map(([key, definition]) => {
          const account = accountFor(key);
          const status = statusPresentation(account);
          const verified = effectiveStatus(account) === "connected";
          const readyCount = Number(
            account?.metadata?.discovered_devices_count || 0,
          );
          const verifiedAt = formattedTime(account?.metadata?.verified_at);

          return (
            <section
              key={key}
              className="flex min-h-[300px] flex-col rounded-2xl border border-zinc-800 bg-zinc-900/65 p-5"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex min-w-0 items-start gap-3">
                  <div className="rounded-xl border border-zinc-700 bg-zinc-950 p-2.5 text-cyan-300">
                    <Icon path={providerIcon(definition)} size={1.05} />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[10px] uppercase tracking-[.16em] text-zinc-600">
                      {definition.category || "Service"}
                    </div>
                    <h2 className="mt-0.5 text-lg font-semibold text-white">
                      {definition.display_name}
                    </h2>
                  </div>
                </div>
                <span
                  className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] ${status.className}`}
                >
                  {status.icon && <Icon path={status.icon} size={0.55} />}
                  {status.label}
                </span>
              </div>

              <p className="mt-4 text-sm leading-6 text-zinc-400">
                {definition.description}
              </p>

              <div className="mt-4 space-y-2 text-xs text-zinc-500">
                {(definition.what_it_does || []).slice(0, 2).map((item) => (
                  <div key={item} className="flex gap-2">
                    <Icon
                      path={mdiPaths.mdiCheck}
                      size={0.55}
                      className="mt-0.5 shrink-0 text-zinc-600"
                    />
                    <span>{item}</span>
                  </div>
                ))}
              </div>

              <div className="mt-auto pt-5">
                {verified && (
                  <div className="mb-3 rounded-xl border border-zinc-800 bg-zinc-950/60 p-3 text-xs">
                    {definition.supports_device_discovery ? (
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-zinc-500">
                          Devices ready to add
                        </span>
                        <span className="font-semibold text-white">
                          {readyCount}
                        </span>
                      </div>
                    ) : (
                      <div className="text-zinc-500">
                        Connection verified
                      </div>
                    )}
                    {verifiedAt && (
                      <div className="mt-1 text-[11px] text-zinc-600">
                        Last verified {verifiedAt}
                      </div>
                    )}
                  </div>
                )}

                {account?.error && (
                  <div className="mb-3 line-clamp-2 text-xs text-red-400">
                    {account.error}
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => openProvider(key)}
                    className="rounded-lg bg-cyan-700 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-600"
                  >
                    {!account
                      ? "Set up"
                      : verified
                        ? "Manage"
                        : "Fix connection"}
                  </button>

                  {verified && definition.supports_device_discovery && (
                    <button
                      type="button"
                      disabled={busyProvider === key}
                      onClick={() => void discoverDevices(key)}
                      className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-300 hover:border-cyan-800 hover:text-white disabled:opacity-50"
                    >
                      <Icon path={mdiPaths.mdiRadar} size={0.65} />
                      Check devices
                    </button>
                  )}

                  {verified &&
                    definition.supports_device_discovery &&
                    readyCount > 0 && (
                      <button
                        type="button"
                        onClick={() => navigate("/devices")}
                        className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-300 hover:text-white"
                      >
                        <Icon path={mdiPaths.mdiDevices} size={0.65} />
                        Devices
                      </button>
                    )}
                </div>
              </div>
            </section>
          );
        })}
      </div>

      <Modal
        open={Boolean(selectedProvider && selectedDefinition)}
        onClose={() => {
          if (!busyProvider) setSelectedProvider(null);
        }}
        title={
          selectedDefinition
            ? `${selectedAccount ? "Manage" : "Set up"} ${selectedDefinition.display_name}`
            : "Integration"
        }
        width="max-w-5xl"
      >
        {selectedProvider && selectedDefinition && (
          <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
            <div className="space-y-5">
              <section className="rounded-2xl border border-zinc-800 bg-zinc-950/50 p-4">
                <div className="flex items-center gap-3">
                  <div className="rounded-xl border border-zinc-700 bg-zinc-900 p-2.5 text-cyan-300">
                    <Icon
                      path={providerIcon(selectedDefinition)}
                      size={1.1}
                    />
                  </div>
                  <div>
                    <div className="text-xs text-zinc-500">
                      {selectedDefinition.category}
                    </div>
                    <div className="font-semibold text-white">
                      {selectedDefinition.display_name}
                    </div>
                  </div>
                </div>
                <p className="mt-4 text-sm leading-6 text-zinc-400">
                  {selectedDefinition.description}
                </p>
              </section>

              <section>
                <h3 className="text-sm font-semibold text-white">
                  What this enables
                </h3>
                <div className="mt-2 space-y-2">
                  {(selectedDefinition.what_it_does || []).map((item) => (
                    <div
                      key={item}
                      className="flex gap-2 text-sm leading-5 text-zinc-400"
                    >
                      <Icon
                        path={mdiPaths.mdiCheckCircleOutline}
                        size={0.65}
                        className="mt-0.5 shrink-0 text-cyan-600"
                      />
                      {item}
                    </div>
                  ))}
                </div>
              </section>

              <section>
                <h3 className="text-sm font-semibold text-white">
                  Setup steps
                </h3>
                <ol className="mt-2 space-y-3">
                  {(selectedDefinition.setup_steps || []).map(
                    (step, index) => (
                      <li
                        key={step}
                        className="flex gap-3 text-sm leading-5 text-zinc-400"
                      >
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-zinc-700 bg-zinc-900 text-[11px] text-zinc-400">
                          {index + 1}
                        </span>
                        <span>{step}</span>
                      </li>
                    ),
                  )}
                </ol>
              </section>

              {(selectedDefinition.notes || []).length > 0 && (
                <section className="rounded-xl border border-amber-900/50 bg-amber-950/20 p-3">
                  <div className="flex gap-2">
                    <Icon
                      path={mdiPaths.mdiInformationOutline}
                      size={0.7}
                      className="mt-0.5 shrink-0 text-amber-400"
                    />
                    <div className="space-y-1 text-xs leading-5 text-amber-100/60">
                      {(selectedDefinition.notes || []).map((note) => (
                        <p key={note}>{note}</p>
                      ))}
                    </div>
                  </div>
                </section>
              )}
            </div>

            <div>
              <div className="rounded-2xl border border-zinc-800 bg-zinc-950/50 p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="font-semibold text-white">
                      Connection details
                    </h3>
                    <p className="mt-1 text-xs text-zinc-500">
                      Credentials are encrypted before they are stored.
                    </p>
                  </div>
                  {selectedAccount && (
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] ${statusPresentation(selectedAccount).className}`}
                    >
                      <Icon
                        path={statusPresentation(selectedAccount).icon}
                        size={0.55}
                      />
                      {statusPresentation(selectedAccount).label}
                    </span>
                  )}
                </div>

                <div className="mt-5 grid gap-4">
                  {selectedDefinition.fields.map((field) => {
                    const configured =
                      selectedAccount?.configured_credentials.includes(
                        field.name,
                      );
                    const value =
                      forms[selectedProvider]?.[field.name] ??
                      field.default ??
                      "";

                    return (
                      <label
                        key={field.name}
                        className="block text-xs text-zinc-400"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span>
                            {field.label}
                            {!field.optional && (
                              <span className="ml-1 text-red-400">*</span>
                            )}
                          </span>
                          {configured && (
                            <span className="inline-flex items-center gap-1 text-[10px] text-emerald-500">
                              <Icon
                                path={mdiPaths.mdiCheckCircle}
                                size={0.45}
                              />
                              saved
                            </span>
                          )}
                        </div>
                        <input
                          type={
                            field.type === "password"
                              ? "password"
                              : field.type === "number"
                                ? "number"
                                : "text"
                          }
                          value={value as string | number}
                          placeholder={
                            configured
                              ? "Configured — leave blank to keep"
                              : ""
                          }
                          onChange={(event) =>
                            setForms((current) => ({
                              ...current,
                              [selectedProvider]: {
                                ...(current[selectedProvider] || {}),
                                [field.name]:
                                  field.type === "number" &&
                                  event.target.value !== ""
                                    ? Number(event.target.value)
                                    : event.target.value,
                              },
                            }))
                          }
                          className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-700"
                        />
                        {field.description && (
                          <span className="mt-1.5 block text-[11px] leading-4 text-zinc-600">
                            {field.description}
                          </span>
                        )}
                      </label>
                    );
                  })}
                </div>

                {selectedAccount?.error && (
                  <div className="mt-4 rounded-xl border border-red-900/60 bg-red-950/30 p-3 text-xs leading-5 text-red-300">
                    {selectedAccount.error}
                  </div>
                )}

                {message && (
                  <div className="mt-4 rounded-xl border border-cyan-900/60 bg-cyan-950/25 p-3 text-xs leading-5 text-cyan-200">
                    {message}
                  </div>
                )}
                {error && (
                  <div className="mt-4 rounded-xl border border-red-900/60 bg-red-950/30 p-3 text-xs leading-5 text-red-300">
                    {error}
                  </div>
                )}

                <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-zinc-800 pt-4">
                  <button
                    type="button"
                    disabled={busyProvider === selectedProvider}
                    onClick={() =>
                      void saveAndConnect(selectedProvider)
                    }
                    className="inline-flex items-center gap-2 rounded-lg bg-cyan-700 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-600 disabled:opacity-50"
                  >
                    <Icon
                      path={
                        selectedDefinition.auth_type === "oauth"
                          ? mdiPaths.mdiOpenInNew
                          : mdiPaths.mdiLanConnect
                      }
                      size={0.65}
                    />
                    {busyProvider === selectedProvider
                      ? "Checking…"
                      : selectedDefinition.auth_type === "oauth" &&
                          effectiveStatus(selectedAccount) !== "connected"
                        ? "Save & authorise"
                        : selectedAccount
                          ? "Test & reconnect"
                          : "Test & connect"}
                  </button>

                  {selectedAccount &&
                    selectedDefinition.supports_device_discovery &&
                    effectiveStatus(selectedAccount) === "connected" && (
                      <button
                        type="button"
                        disabled={busyProvider === selectedProvider}
                        onClick={() =>
                          void discoverDevices(selectedProvider)
                        }
                        className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:text-white disabled:opacity-50"
                      >
                        <Icon path={mdiPaths.mdiRadar} size={0.65} />
                        Discover devices
                      </button>
                    )}

                  {selectedDefinition.auth_type === "oauth" &&
                    selectedAccount && (
                      <button
                        type="button"
                        onClick={() => void load()}
                        className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:text-white"
                      >
                        <Icon path={mdiPaths.mdiRefresh} size={0.65} />
                        Refresh status
                      </button>
                    )}

                  {selectedAccount && (
                    <button
                      type="button"
                      disabled={busyProvider === selectedProvider}
                      onClick={() =>
                        void forgetIntegration(selectedProvider)
                      }
                      className="ml-auto rounded-lg px-3 py-2 text-sm text-red-400 hover:bg-red-950/30 disabled:opacity-50"
                    >
                      Remove integration
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function SummaryCard({
  icon,
  label,
  value,
  tone,
}: {
  icon: string;
  label: string;
  value: number;
  tone: "emerald" | "amber" | "zinc";
}) {
  const toneClasses = {
    emerald: "text-emerald-400",
    amber: "text-amber-400",
    zinc: "text-zinc-400",
  };
  return (
    <div className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
      <div className={toneClasses[tone]}>
        <Icon path={icon} size={0.9} />
      </div>
      <div>
        <div className="text-xl font-semibold text-white">{value}</div>
        <div className="text-xs text-zinc-500">{label}</div>
      </div>
    </div>
  );
}
