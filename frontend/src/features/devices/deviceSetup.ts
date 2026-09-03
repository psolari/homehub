import type {
  Device,
  DiscoveryCandidate,
  DriverDefinition,
  DriverField,
  IntegrationAccount,
} from "../../shared/types";

export type DeviceSetupValues = {
  name: string;
  ip_address: string;
  mac_address: string;
  manufacturer: string;
  hardware_model: string;
  device_type: string;
  model: string;
  source: string;
  unique_id?: string;
  config: Record<string, unknown>;
  discovery_data?: Record<string, unknown>;
};

export function setupValuesFrom(
  driver: DriverDefinition,
  candidate?: DiscoveryCandidate | null,
  existing?: Device | null,
): DeviceSetupValues {
  const fieldDefaults = Object.fromEntries(
    (driver.fields || [])
      .filter((field) => field.default !== undefined)
      .map((field) => [field.name, field.default]),
  );
  return {
    name: existing?.name || candidate?.name || driver.display_name,
    ip_address: existing?.ip_address || candidate?.ip_address || "",
    mac_address: existing?.mac_address || candidate?.mac_address || "",
    manufacturer: existing?.manufacturer || candidate?.manufacturer || driver.manufacturer || "",
    hardware_model: existing?.hardware_model || candidate?.hardware_model || "",
    device_type: existing?.device_type || candidate?.device_type || driver.device_type,
    model: existing?.model || candidate?.model || driver.key,
    source: existing?.source || candidate?.source || "manual",
    unique_id: existing?.unique_id || candidate?.unique_id,
    config: {
      ...fieldDefaults,
      ...(candidate?.config || {}),
      ...(existing?.config || {}),
    },
    discovery_data: candidate?.discovery_data || undefined,
  };
}

export function configuredSecretNames(existing?: Device | null): Set<string> {
  return new Set(existing?.configured_credentials || []);
}

export function isFieldSatisfied(
  field: DriverField,
  config: Record<string, unknown>,
  existingSecrets: Set<string>,
) {
  const value = config[field.name];
  if (value !== undefined && value !== null && String(value).trim() !== "") return true;
  return Boolean(field.secret && existingSecrets.has(field.name));
}

export function missingSetupRequirements(
  driver: DriverDefinition,
  values: DeviceSetupValues,
  existing?: Device | null,
) {
  const missing: string[] = [];
  const setup = driver.setup || {};
  if (!values.name.trim()) missing.push("Device name");
  if (setup.requires_ip && !values.ip_address.trim()) missing.push("IP address");
  if (setup.requires_mac && !values.mac_address.trim()) missing.push("MAC address");
  const existingSecrets = configuredSecretNames(existing);
  for (const field of driver.fields || []) {
    if (field.required && !isFieldSatisfied(field, values.config, existingSecrets)) {
      missing.push(field.label);
    }
  }
  return [...new Set(missing)];
}

export function buildSetupPayload(
  values: DeviceSetupValues,
  driver: DriverDefinition,
  existing?: Device | null,
) {
  const config: Record<string, unknown> = {};
  const existingSecrets = configuredSecretNames(existing);
  for (const field of driver.fields || []) {
    const value = values.config[field.name];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      config[field.name] = value;
    } else if (!field.secret || !existingSecrets.has(field.name)) {
      // Omit blank values. For an existing secret, omission means "keep it".
    }
  }
  return {
    name: values.name.trim(),
    ip_address: values.ip_address.trim() || null,
    mac_address: values.mac_address.trim() || null,
    manufacturer: values.manufacturer.trim(),
    hardware_model: values.hardware_model.trim(),
    device_type: values.device_type,
    model: values.model,
    source: values.source,
    unique_id: values.unique_id || null,
    discovery_data: values.discovery_data || {},
    config,
    validate_connection: driver.setup?.test_connection !== false,
  };
}

export function accountForField(
  accounts: IntegrationAccount[],
  provider: string,
  configValue: unknown,
) {
  const id = Number(configValue || 0);
  return accounts.find((account) => account.provider === provider && account.id === id) || null;
}

export function visibleDriverFields(driver: DriverDefinition, showAdvanced: boolean) {
  const setup = driver.setup || {};
  const accountFields = new Set([
    ...(setup.account_field ? [setup.account_field] : []),
    ...(setup.optional_accounts || []).map((item) => item.field),
  ]);
  const advanced = new Set(setup.advanced_fields || []);
  return (driver.fields || []).filter(
    (field) => !accountFields.has(field.name) && (showAdvanced || !advanced.has(field.name)),
  );
}
