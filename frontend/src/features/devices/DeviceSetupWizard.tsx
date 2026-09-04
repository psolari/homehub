import { useEffect, useMemo, useState } from "react";

import { get, patch, post } from "../../shared/api/client";
import Modal from "../../shared/components/Modal";
import type {
  Device,
  DiscoveryCandidate,
  DriverCatalog,
  DriverDefinition,
  IntegrationAccount,
  ProviderCatalog,
  SetupAccountDefinition,
} from "../../shared/types";
import {
  accountForField,
  buildSetupPayload,
  configuredSecretNames,
  missingSetupRequirements,
  setupValuesFrom,
  visibleDriverFields,
  type DeviceSetupValues,
} from "./deviceSetup";

type Props = {
  open: boolean;
  catalog: DriverCatalog;
  candidate?: DiscoveryCandidate | null;
  existing?: Device | null;
  onClose: () => void;
  onComplete: (device: Device) => void;
};

type SetupResult = { device: Device; state?: Record<string, unknown> };
type AccountFormState = Record<string, Record<string, string | number>>;

const STEPS = ["Device", "Accounts", "Configuration", "Test & finish"] as const;

export default function DeviceSetupWizard({
  open,
  catalog,
  candidate = null,
  existing = null,
  onClose,
  onComplete,
}: Props) {
  const [step, setStep] = useState(0);
  const [deviceType, setDeviceType] = useState("");
  const [model, setModel] = useState("");
  const [values, setValues] = useState<DeviceSetupValues | null>(null);
  const [accounts, setAccounts] = useState<IntegrationAccount[]>([]);
  const [providers, setProviders] = useState<ProviderCatalog>({});
  const [accountForms, setAccountForms] = useState<AccountFormState>({});
  const [accountNames, setAccountNames] = useState<Record<string, string>>({});
  const [showAccountForm, setShowAccountForm] = useState<Record<string, boolean>>({});
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const drivers = catalog[deviceType] || {};
  const driver = drivers[model] || null;

  useEffect(() => {
    if (!open) return;
    const initialType = existing?.device_type || candidate?.device_type || Object.keys(catalog)[0] || "appliance";
    const typeDrivers = catalog[initialType] || {};
    const initialModel =
      existing?.model ||
      candidate?.model ||
      (typeDrivers.generic ? "generic" : Object.keys(typeDrivers)[0] || "generic");
    const definition = typeDrivers[initialModel];
    setDeviceType(initialType);
    setModel(initialModel);
    setValues(definition ? setupValuesFrom(definition, candidate, existing) : null);
    setStep(0);
    setError("");
    setMessage("");
    setShowAdvanced(false);
    setAccountForms({});
    setAccountNames({});
    setShowAccountForm({});

    void Promise.all([
      get<IntegrationAccount[]>("/integration-accounts/"),
      get<ProviderCatalog>("/provider-catalog/"),
    ])
      .then(([nextAccounts, nextProviders]) => {
        setAccounts(nextAccounts);
        setProviders(nextProviders);
      })
      .catch((reason: Error) => setError(reason.message));
  }, [open, candidate?.unique_id, existing?.id, catalog]);

  useEffect(() => {
    if (!open || !driver || !values) return;
    const nextConfig = { ...values.config };
    const dependencies = accountDependencies(driver);
    let changed = false;
    for (const dependency of dependencies) {
      if (nextConfig[dependency.field]) continue;
      const matching = accounts.filter((account) => account.provider === dependency.provider && account.active);
      if (matching.length === 1) {
        nextConfig[dependency.field] = matching[0].id;
        changed = true;
      }
    }
    if (changed) setValues({ ...values, config: nextConfig });
  }, [accounts, driver, open]);

  const missing = useMemo(
    () => (driver && values ? missingSetupRequirements(driver, values, existing) : ["Device integration"]),
    [driver, values, existing],
  );

  if (!values || !driver) {
    return (
      <Modal open={open} onClose={onClose} title="Set up device">
        <div className="text-sm text-zinc-400">Loading device setup…</div>
      </Modal>
    );
  }

  const changeDriver = (nextType: string, nextModel?: string) => {
    const nextDrivers = catalog[nextType] || {};
    const nextKey = nextModel || (nextDrivers.generic ? "generic" : Object.keys(nextDrivers)[0] || "generic");
    const nextDriver = nextDrivers[nextKey];
    if (!nextDriver) return;
    setDeviceType(nextType);
    setModel(nextKey);
    setValues((current) => {
      const next = setupValuesFrom(nextDriver, candidate, existing);
      if (!current) return next;
      return {
        ...next,
        name: current.name,
        ip_address: current.ip_address,
        mac_address: current.mac_address,
        manufacturer: current.manufacturer || next.manufacturer,
        hardware_model: current.hardware_model,
        source: current.source,
        unique_id: current.unique_id,
        discovery_data: current.discovery_data,
      };
    });
    setError("");
    setMessage("");
  };

  const setBasic = (key: keyof DeviceSetupValues, value: unknown) => {
    setValues((current) => (current ? { ...current, [key]: value } : current));
  };

  const setConfig = (name: string, value: unknown) => {
    setValues((current) =>
      current ? { ...current, config: { ...current.config, [name]: value } } : current,
    );
  };

  const runSetupAction = async (action: string) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await post<{ message?: string; config?: Record<string, unknown> }>(
        "/devices/setup-action/",
        {
          device_type: deviceType,
          model,
          action,
          device: {
            name: values.name,
            ip_address: values.ip_address || null,
            mac_address: values.mac_address || null,
          },
          config: values.config,
        },
      );
      if (result.config) {
        setValues((current) =>
          current ? { ...current, config: { ...current.config, ...result.config } } : current,
        );
      }
      setMessage(result.message || "Setup action completed.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Setup action failed");
    } finally {
      setBusy(false);
    }
  };

  const saveAccount = async (dependency: SetupAccountDefinition) => {
    const provider = providers[dependency.provider];
    if (!provider) {
      setError(`Provider ${dependency.provider} is not available.`);
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const selected = accountForField(accounts, dependency.provider, values.config[dependency.field]);
      const form = accountForms[dependency.provider] || {};
      const credentials: Record<string, unknown> = {};
      for (const field of provider.fields) {
        const value = form[field.name] !== undefined ? form[field.name] : field.default;
        if (value !== undefined && value !== "") credentials[field.name] = value;
      }
      let account: IntegrationAccount;
      if (selected) {
        account = await patch<IntegrationAccount>(`/integration-accounts/${selected.id}/`, { credentials });
      } else {
        account = await post<IntegrationAccount>("/integration-accounts/", {
          provider: dependency.provider,
          name: accountNames[dependency.provider]?.trim() || "Default",
          credentials,
          config: {},
        });
      }
      const connection = await post<{ authorization_url?: string } & IntegrationAccount>(
        `/integration-accounts/${account.id}/connect/`,
      );
      if (connection.authorization_url) {
        window.open(connection.authorization_url, "_blank", "noopener,noreferrer");
        setMessage(
          "Complete authorisation in the new browser tab. When it succeeds, return here and continue setup.",
        );
      } else {
        setMessage(`${provider.display_name} account saved. The final device test will verify it.`);
      }
      const refreshed = await get<IntegrationAccount[]>("/integration-accounts/");
      setAccounts(refreshed);
      setConfig(dependency.field, account.id);
      setShowAccountForm((current) => ({ ...current, [dependency.provider]: false }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save integration account");
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    if (missing.length) {
      setError(`Complete these items first: ${missing.join(", ")}.`);
      return;
    }
    setBusy(true);
    setError("");
    setMessage(driver.setup?.test_connection === false ? "Saving device…" : "Testing connection…");
    try {
      const payload = buildSetupPayload(values, driver, existing);
      const result = existing
        ? await post<SetupResult>(`/devices/${existing.id}/setup/`, payload)
        : await post<SetupResult>("/devices/complete-setup/", payload);
      setMessage("Device setup completed successfully.");
      onComplete(result.device);
    } catch (reason) {
      setMessage("");
      setError(reason instanceof Error ? reason.message : "Device setup failed");
    } finally {
      setBusy(false);
    }
  };

  const canAdvanceDevice = Boolean(values.name.trim() && (!driver.setup?.requires_ip || values.ip_address.trim()));
  const dependencies = accountDependencies(driver);

  return (
    <Modal
      open={open}
      onClose={busy ? () => undefined : onClose}
      title={`${existing ? "Finish setup" : "Set up"}: ${values.name || driver.display_name}`}
      width="max-w-4xl"
    >
      <div className="space-y-5">
        <WizardProgress step={step} />

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

        {step === 0 && (
          <DeviceStep
            values={values}
            driver={driver}
            catalog={catalog}
            manual={!candidate && !existing}
            onDriverChange={changeDriver}
            onBasic={setBasic}
          />
        )}

        {step === 1 && (
          <AccountsStep
            driver={driver}
            dependencies={dependencies}
            accounts={accounts}
            providers={providers}
            values={values}
            accountForms={accountForms}
            accountNames={accountNames}
            showAccountForm={showAccountForm}
            busy={busy}
            onConfig={setConfig}
            onShowForm={(provider, show) =>
              setShowAccountForm((current) => ({ ...current, [provider]: show }))
            }
            onAccountForm={(provider, field, value) =>
              setAccountForms((current) => ({
                ...current,
                [provider]: { ...(current[provider] || {}), [field]: value },
              }))
            }
            onAccountName={(provider, value) =>
              setAccountNames((current) => ({ ...current, [provider]: value }))
            }
            onSaveAccount={(dependency) => void saveAccount(dependency)}
          />
        )}

        {step === 2 && (
          <ConfigurationStep
            driver={driver}
            values={values}
            existing={existing}
            showAdvanced={showAdvanced}
            busy={busy}
            onShowAdvanced={setShowAdvanced}
            onConfig={setConfig}
            onAction={(action) => void runSetupAction(action)}
          />
        )}

        {step === 3 && (
          <FinishStep driver={driver} values={values} missing={missing} existing={existing} />
        )}

        <div className="flex items-center justify-between border-t border-zinc-800 pt-4">
          <button
            onClick={() => (step === 0 ? onClose() : setStep((current) => current - 1))}
            disabled={busy}
            className="rounded-lg border border-zinc-700 px-4 py-2 text-sm disabled:opacity-50"
          >
            {step === 0 ? "Cancel" : "Back"}
          </button>
          {step < STEPS.length - 1 ? (
            <button
              onClick={() => {
                setError("");
                setMessage("");
                setStep((current) => current + 1);
              }}
              disabled={busy || (step === 0 && !canAdvanceDevice)}
              className="rounded-lg bg-cyan-700 px-5 py-2 text-sm font-semibold disabled:opacity-40"
            >
              Continue
            </button>
          ) : (
            <button
              onClick={() => void finish()}
              disabled={busy || missing.length > 0}
              className="rounded-lg bg-cyan-700 px-5 py-2 text-sm font-semibold disabled:opacity-40"
            >
              {busy
                ? driver.setup?.test_connection === false
                  ? "Saving…"
                  : "Testing…"
                : existing
                  ? "Test & save"
                  : driver.setup?.test_connection === false
                    ? "Add device"
                    : "Test & add"}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}

function WizardProgress({ step }: { step: number }) {
  return (
    <div className="grid grid-cols-4 gap-2">
      {STEPS.map((label, index) => (
        <div key={label}>
          <div
            className={`h-1.5 rounded-full ${index <= step ? "bg-cyan-500" : "bg-zinc-800"}`}
          />
          <div className={`mt-2 text-xs ${index === step ? "text-cyan-300" : "text-zinc-600"}`}>
            {index + 1}. {label}
          </div>
        </div>
      ))}
    </div>
  );
}

function DeviceStep({
  values,
  driver,
  catalog,
  manual,
  onDriverChange,
  onBasic,
}: {
  values: DeviceSetupValues;
  driver: DriverDefinition;
  catalog: DriverCatalog;
  manual: boolean;
  onDriverChange: (type: string, model?: string) => void;
  onBasic: (key: keyof DeviceSetupValues, value: unknown) => void;
}) {
  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-lg font-semibold text-white">Device identity</h3>
        <p className="mt-1 text-sm text-zinc-400">{driver.setup?.description || "Configure this HomeHub device."}</p>
      </div>

      {manual && (
        <div className="grid gap-3 md:grid-cols-2">
          <FieldLabel label="Device type">
            <select
              value={values.device_type}
              onChange={(event) => onDriverChange(event.target.value)}
              className={inputClass}
            >
              {Object.keys(catalog).map((type) => (
                <option key={type} value={type}>
                  {pretty(type)}
                </option>
              ))}
            </select>
          </FieldLabel>
          <FieldLabel label="Integration">
            <select
              value={values.model}
              onChange={(event) => onDriverChange(values.device_type, event.target.value)}
              className={inputClass}
            >
              {Object.values(catalog[values.device_type] || {}).map((definition) => (
                <option key={definition.key} value={definition.key}>
                  {definition.display_name}
                </option>
              ))}
            </select>
          </FieldLabel>
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        <TextField label="Name" required value={values.name} onChange={(value) => onBasic("name", value)} />
        <TextField
          label="IP address"
          required={driver.setup?.requires_ip}
          value={values.ip_address}
          onChange={(value) => onBasic("ip_address", value)}
          placeholder={driver.setup?.requires_ip ? "Required for this integration" : "Optional / cloud device"}
        />
        <TextField
          label={driver.setup?.auto_discover_mac ? "MAC address (auto-detected)" : "MAC address"}
          required={driver.setup?.requires_mac}
          value={values.mac_address}
          onChange={(value) => onBasic("mac_address", value)}
          placeholder={
            driver.setup?.auto_discover_mac
              ? "HomeHub will detect this automatically"
              : "Optional unless required for wake/control"
          }
        />
        <TextField
          label="Manufacturer"
          value={values.manufacturer}
          onChange={(value) => onBasic("manufacturer", value)}
        />
        <TextField
          label="Hardware model"
          value={values.hardware_model}
          onChange={(value) => onBasic("hardware_model", value)}
        />
        <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3">
          <div className="text-[10px] uppercase tracking-[.18em] text-zinc-600">HomeHub driver</div>
          <div className="mt-1 font-medium text-zinc-200">{driver.display_name}</div>
          <div className="mt-1 text-xs text-zinc-600">{values.source === "manual" ? "Manual setup" : "Discovered device"}</div>
        </div>
      </div>

      {(driver.setup?.instructions || []).length > 0 && (
        <InstructionCard instructions={driver.setup?.instructions || []} />
      )}
    </div>
  );
}

function AccountsStep({
  driver,
  dependencies,
  accounts,
  providers,
  values,
  accountForms,
  accountNames,
  showAccountForm,
  busy,
  onConfig,
  onShowForm,
  onAccountForm,
  onAccountName,
  onSaveAccount,
}: {
  driver: DriverDefinition;
  dependencies: SetupAccountDefinition[];
  accounts: IntegrationAccount[];
  providers: ProviderCatalog;
  values: DeviceSetupValues;
  accountForms: AccountFormState;
  accountNames: Record<string, string>;
  showAccountForm: Record<string, boolean>;
  busy: boolean;
  onConfig: (name: string, value: unknown) => void;
  onShowForm: (provider: string, show: boolean) => void;
  onAccountForm: (provider: string, field: string, value: string | number) => void;
  onAccountName: (provider: string, value: string) => void;
  onSaveAccount: (dependency: SetupAccountDefinition) => void;
}) {
  if (!dependencies.length) {
    return (
      <div className="rounded-2xl border border-zinc-800 bg-zinc-950/50 p-6">
        <h3 className="text-lg font-semibold text-white">No cloud account required</h3>
        <p className="mt-2 text-sm leading-6 text-zinc-400">
          {driver.display_name} is configured directly. Continue to device-specific configuration.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold text-white">Accounts and services</h3>
        <p className="mt-1 text-sm text-zinc-400">
          Link only the accounts this integration needs. Optional services can be skipped.
        </p>
      </div>
      {dependencies.map((dependency) => {
        const provider = providers[dependency.provider];
        const matching = accounts.filter((account) => account.provider === dependency.provider);
        const selectedId = String(values.config[dependency.field] || "");
        const selected = accountForField(accounts, dependency.provider, selectedId);
        const isPrimary = driver.setup?.account_field === dependency.field;
        return (
          <section key={dependency.field} className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="font-medium text-white">
                  {dependency.label} {isPrimary ? <span className="text-red-400">*</span> : <span className="text-zinc-600">optional</span>}
                </div>
                <p className="mt-1 text-xs leading-5 text-zinc-500">{dependency.description || provider?.description}</p>
              </div>
              {selected && (
                <span className={`rounded-full px-2 py-1 text-[10px] ${selected.status === "connected" ? "bg-emerald-950 text-emerald-300" : "bg-zinc-800 text-zinc-400"}`}>
                  {selected.status}
                </span>
              )}
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <select
                value={selectedId}
                onChange={(event) => onConfig(dependency.field, event.target.value ? Number(event.target.value) : "")}
                className={`${inputClass} min-w-[240px] flex-1`}
              >
                <option value="">{isPrimary ? "Choose account…" : "None"}</option>
                {matching.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name} — {account.status}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => onShowForm(dependency.provider, !showAccountForm[dependency.provider])}
                className="rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-300"
              >
                {selected ? "Update credentials" : "Configure account"}
              </button>
            </div>

            {showAccountForm[dependency.provider] && provider && (
              <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-900/70 p-4">
                {!selected && (
                  <TextField
                    label="Account label"
                    value={accountNames[dependency.provider] || "Default"}
                    onChange={(value) => onAccountName(dependency.provider, value)}
                  />
                )}
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  {provider.fields.map((field) => (
                    <FieldLabel key={field.name} label={field.label} optional={field.optional}>
                      <input
                        type={field.type === "password" ? "password" : field.type === "number" ? "number" : "text"}
                        value={accountForms[dependency.provider]?.[field.name] ?? field.default ?? ""}
                        placeholder={selected?.configured_credentials.includes(field.name) ? "Configured — leave blank to keep" : ""}
                        onChange={(event) =>
                          onAccountForm(
                            dependency.provider,
                            field.name,
                            field.type === "number" ? Number(event.target.value) : event.target.value,
                          )
                        }
                        className={inputClass}
                      />
                    </FieldLabel>
                  ))}
                </div>
                <div className="mt-3 flex justify-end">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onSaveAccount(dependency)}
                    className="rounded-lg bg-cyan-700 px-4 py-2 text-sm font-semibold disabled:opacity-50"
                  >
                    {busy ? "Saving…" : selected ? "Save & reconnect" : "Save account"}
                  </button>
                </div>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

function ConfigurationStep({
  driver,
  values,
  existing,
  showAdvanced,
  busy,
  onShowAdvanced,
  onConfig,
  onAction,
}: {
  driver: DriverDefinition;
  values: DeviceSetupValues;
  existing: Device | null;
  showAdvanced: boolean;
  busy: boolean;
  onShowAdvanced: (value: boolean) => void;
  onConfig: (name: string, value: unknown) => void;
  onAction: (action: string) => void;
}) {
  const fields = visibleDriverFields(driver, showAdvanced);
  const advanced = new Set(driver.setup?.advanced_fields || []);
  const hasAdvanced = (driver.fields || []).some((field) => advanced.has(field.name));
  const existingSecrets = configuredSecretNames(existing);

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-lg font-semibold text-white">{driver.display_name} configuration</h3>
        <p className="mt-1 text-sm text-zinc-400">
          Enter the device-specific information HomeHub needs. Secrets are encrypted by the backend.
        </p>
      </div>

      {(driver.setup?.actions || []).map((action) => {
        const missingActionRequirement = (action.requires || []).find((requirement) => {
          if (requirement === "ip_address") return !values.ip_address;
          if (requirement === "mac_address") return !values.mac_address;
          return !values.config[requirement];
        });
        return (
          <div key={action.key} className="rounded-xl border border-cyan-900/70 bg-cyan-950/20 p-4">
            <div className="font-medium text-cyan-100">{action.label}</div>
            {action.description && <p className="mt-1 text-xs leading-5 text-cyan-200/60">{action.description}</p>}
            <button
              type="button"
              disabled={busy || Boolean(missingActionRequirement)}
              onClick={() => onAction(action.key)}
              className="mt-3 rounded-lg border border-cyan-800 px-3 py-2 text-sm text-cyan-300 disabled:opacity-40"
            >
              {busy ? "Working…" : action.label}
            </button>
            {missingActionRequirement && (
              <div className="mt-2 text-xs text-amber-400">Complete {pretty(missingActionRequirement)} first.</div>
            )}
          </div>
        );
      })}

      <div className="grid gap-4 md:grid-cols-2">
        {fields.map((field) => {
          const value = values.config[field.name] ?? field.default ?? "";
          const configured = field.secret && existingSecrets.has(field.name);
          return (
            <FieldLabel key={field.name} label={field.label} required={field.required}>
              <input
                type={field.type === "password" ? "password" : field.type === "number" ? "number" : "text"}
                value={value as string | number}
                placeholder={configured ? "Already configured — leave blank to keep" : ""}
                onChange={(event) =>
                  onConfig(
                    field.name,
                    field.type === "number" && event.target.value !== ""
                      ? Number(event.target.value)
                      : event.target.value,
                  )
                }
                className={inputClass}
              />
              {field.description && <span className="mt-1 block text-[11px] leading-4 text-zinc-600">{field.description}</span>}
              {configured && <span className="mt-1 block text-[11px] text-emerald-500">A secret value is already stored.</span>}
            </FieldLabel>
          );
        })}
      </div>

      {hasAdvanced && (
        <button
          type="button"
          onClick={() => onShowAdvanced(!showAdvanced)}
          className="text-sm text-cyan-400 hover:text-cyan-300"
        >
          {showAdvanced ? "Hide advanced settings" : "Show advanced settings"}
        </button>
      )}
    </div>
  );
}

function FinishStep({
  driver,
  values,
  missing,
  existing,
}: {
  driver: DriverDefinition;
  values: DeviceSetupValues;
  missing: string[];
  existing: Device | null;
}) {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold text-white">Ready to {existing ? "reconfigure" : "add"} device</h3>
        <p className="mt-1 text-sm text-zinc-400">
          {driver.setup?.test_connection === false
            ? "This generic integration has no active connection test; HomeHub will store the device information."
            : "HomeHub will now pair/authenticate and read live state. The device is only added successfully if that test passes."}
        </p>
      </div>
      <div className="grid gap-2 rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4 text-sm md:grid-cols-2">
        <Summary label="Name" value={values.name} />
        <Summary label="Integration" value={driver.display_name} />
        <Summary label="IP" value={values.ip_address || "Cloud / not required"} />
        <Summary
          label="MAC"
          value={
            values.mac_address ||
            (driver.setup?.auto_discover_mac ? "Will detect automatically during setup" : "Not configured")
          }
        />
      </div>
      {missing.length ? (
        <div className="rounded-xl border border-amber-900 bg-amber-950/30 p-3 text-sm text-amber-300">
          Still required: {missing.join(", ")}
        </div>
      ) : (
        <div className="rounded-xl border border-emerald-900 bg-emerald-950/25 p-3 text-sm text-emerald-300">
          Setup information is complete. Run the final connection test below.
        </div>
      )}
    </div>
  );
}

function accountDependencies(driver: DriverDefinition): SetupAccountDefinition[] {
  const result: SetupAccountDefinition[] = [];
  if (driver.setup?.account_provider && driver.setup.account_field) {
    result.push({
      provider: driver.setup.account_provider,
      field: driver.setup.account_field,
      label: `${pretty(driver.setup.account_provider)} account`,
      description: `Required by ${driver.display_name}.`,
    });
  }
  for (const account of driver.setup?.optional_accounts || []) {
    if (!result.some((item) => item.field === account.field)) result.push(account);
  }
  return result;
}

function InstructionCard({ instructions }: { instructions: string[] }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
      <div className="text-xs font-semibold uppercase tracking-[.15em] text-zinc-500">Before you continue</div>
      <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-6 text-zinc-400">
        {instructions.map((instruction) => (
          <li key={instruction}>{instruction}</li>
        ))}
      </ol>
    </div>
  );
}

function FieldLabel({
  label,
  children,
  required = false,
  optional = false,
}: {
  label: string;
  children: React.ReactNode;
  required?: boolean;
  optional?: boolean;
}) {
  return (
    <label className="block text-xs text-zinc-400">
      <span>
        {label} {required && <span className="text-red-400">*</span>}
        {optional && <span className="text-zinc-600"> optional</span>}
      </span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function TextField({
  label,
  value,
  onChange,
  required = false,
  placeholder = "",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  placeholder?: string;
}) {
  return (
    <FieldLabel label={label} required={required}>
      <input
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className={inputClass}
      />
    </FieldLabel>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[.15em] text-zinc-600">{label}</div>
      <div className="mt-1 text-zinc-200">{value}</div>
    </div>
  );
}

function pretty(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

const inputClass =
  "w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-cyan-700";
