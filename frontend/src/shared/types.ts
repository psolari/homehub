export type ControlDescriptor = {
  action: string;
  label: string;
  type?: "button" | "range" | "toggle" | "select" | "text" | "media_search" | "number_pair";
  group?: string;
  icon?: string;
  state_key?: string;
  parameter?: string;
  min?: number;
  max?: number;
  step?: number;
  options?: { value: string; label: string }[];
  options_from_state?: string;
  placeholder?: string;
};

export type DashboardCard = {
  id: number;
  device: number;
  enabled: boolean;
  size: "small" | "medium" | "large";
  order: number;
  visible_controls: string[];
};

export type Device = {
  id: number;
  name: string;
  description?: string | null;
  room?: number | null;
  static_ip?: boolean;
  ip_address?: string | null;
  mac_address?: string | null;
  device_type: string;
  model: string;
  manufacturer?: string;
  hardware_model?: string;
  unique_id?: string | null;
  source?: string;
  status: string;
  config?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  capabilities?: { controls?: ControlDescriptor[]; driver?: string };
  state?: Record<string, any>;
  is_online?: boolean;
  last_seen?: string | null;
  dashboard_card?: DashboardCard | null;
  latest_location?: { x: number; y: number; heading: number; recorded_at: string } | null;
  configured_credentials?: string[];
};

export type DriverField = {
  name: string;
  label: string;
  type: string;
  required?: boolean;
  secret?: boolean;
  description?: string;
  default?: any;
};

export type SetupActionDefinition = {
  key: string;
  label: string;
  description?: string;
  requires?: string[];
  result_fields?: string[];
};

export type SetupAccountDefinition = {
  provider: string;
  field: string;
  label: string;
  description?: string;
};

export type DriverSetupDefinition = {
  description?: string;
  requires_ip?: boolean;
  requires_mac?: boolean;
  auto_discover_mac?: boolean;
  instructions?: string[];
  account_provider?: string | null;
  account_field?: string | null;
  optional_accounts?: SetupAccountDefinition[];
  actions?: SetupActionDefinition[];
  test_connection?: boolean;
  advanced_fields?: string[];
};

export type DriverDefinition = {
  key: string;
  device_type: string;
  display_name: string;
  manufacturer: string;
  fields: DriverField[];
  controls: ControlDescriptor[];
  setup?: DriverSetupDefinition;
};

export type DriverCatalog = Record<string, Record<string, DriverDefinition>>;

export type DiscoveryCandidate = {
  unique_id: string;
  name: string;
  device_type: string;
  model: string;
  manufacturer?: string;
  hardware_model?: string;
  ip_address?: string;
  mac_address?: string;
  config?: Record<string, unknown>;
  discovery_data?: Record<string, unknown>;
  source?: string;
};

export type ProviderField = {
  name: string;
  label: string;
  type: string;
  default?: any;
  optional?: boolean;
  secret?: boolean;
  description?: string;
};

export type ProviderDefinition = {
  display_name: string;
  description: string;
  category?: string;
  icon?: string;
  what_it_does?: string[];
  setup_steps?: string[];
  notes?: string[];
  supports_device_discovery?: boolean;
  fields: ProviderField[];
  auth_type?: string;
};

export type ProviderCatalog = Record<string, ProviderDefinition>;

export type FloorPlanObjectType =
  | "wall"
  | "door"
  | "window"
  | "stairs"
  | "column"
  | "radiator"
  | "fireplace"
  | "boiler"
  | "kitchen_counter"
  | "kitchen_island"
  | "sink"
  | "oven"
  | "hob"
  | "fridge"
  | "freezer"
  | "dishwasher"
  | "washing_machine"
  | "dryer"
  | "microwave"
  | "toilet"
  | "bath"
  | "shower"
  | "vanity"
  | "bed"
  | "wardrobe"
  | "chest_drawers"
  | "bedside_table"
  | "dresser"
  | "sofa"
  | "armchair"
  | "coffee_table"
  | "side_table"
  | "dining_table"
  | "dining_chair"
  | "desk"
  | "office_chair"
  | "bookshelf"
  | "cabinet"
  | "storage_unit"
  | "rug"
  | "plant"
  | "lamp"
  | "tv_stand"
  | "patio_table"
  | "garden_chair"
  | "barbecue"
  | "appliance"
  | "device"
  | "label";

export type Room = {
  id: number;
  floor_plan: number;
  name: string;
  description?: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  z_index: number;
  properties: Record<string, any>;
};

export type FloorPlanObject = {
  id: number;
  floor_plan: number;
  object_type: FloorPlanObjectType;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  z_index: number;
  properties: Record<string, any>;
  device?: number | null;
};

export type FloorPlan = {
  id: number;
  name: string;
  description?: string;
  svg_data?: string;
  width: number;
  height: number;
  rooms: Room[];
  objects: FloorPlanObject[];
};

export type IntegrationAccount = {
  id: number;
  provider: string;
  name: string;
  config: Record<string, unknown>;
  metadata: Record<string, unknown>;
  status: string;
  error?: string;
  active: boolean;
  configured_credentials: string[];
};
