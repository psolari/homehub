import type { FloorPlanObjectType } from "../../shared/types";

export type PaletteCategory =
  | "Structure"
  | "Living"
  | "Bedroom"
  | "Kitchen"
  | "Bathroom"
  | "Office"
  | "Utility"
  | "Outdoor"
  | "Decor";

export type PaletteItem = {
  type: FloorPlanObjectType;
  label: string;
  category: PaletteCategory;
  width: number;
  height: number;
  description?: string;
};

export type RoomPreset = {
  label: string;
  width: number;
  height: number;
  properties: Record<string, unknown>;
};

export const roomPresets: RoomPreset[] = [
  { label: "Living room", width: 420, height: 320, properties: { room_type: "living", wall_thickness: 14 } },
  { label: "Kitchen", width: 360, height: 300, properties: { room_type: "kitchen", wall_thickness: 14 } },
  { label: "Dining room", width: 340, height: 280, properties: { room_type: "dining", wall_thickness: 14 } },
  { label: "Bedroom", width: 340, height: 300, properties: { room_type: "bedroom", wall_thickness: 14 } },
  { label: "Bathroom", width: 240, height: 220, properties: { room_type: "bathroom", wall_thickness: 14 } },
  { label: "Hall / landing", width: 220, height: 360, properties: { room_type: "hall", wall_thickness: 14 } },
  { label: "Office", width: 300, height: 260, properties: { room_type: "office", wall_thickness: 14 } },
  { label: "Utility room", width: 240, height: 200, properties: { room_type: "utility", wall_thickness: 14 } },
  { label: "Custom room", width: 320, height: 240, properties: { room_type: "room", wall_thickness: 14 } },
];

export const floorPlanPalette: PaletteItem[] = [
  { type: "wall", label: "Wall", category: "Structure", width: 180, height: 14, description: "Standalone internal or external wall" },
  { type: "door", label: "Door", category: "Structure", width: 90, height: 12 },
  { type: "window", label: "Window", category: "Structure", width: 110, height: 10 },
  { type: "stairs", label: "Stairs", category: "Structure", width: 150, height: 100 },
  { type: "column", label: "Column", category: "Structure", width: 34, height: 34 },
  { type: "radiator", label: "Radiator", category: "Structure", width: 90, height: 22 },
  { type: "fireplace", label: "Fireplace", category: "Structure", width: 105, height: 38 },
  { type: "boiler", label: "Boiler", category: "Structure", width: 55, height: 45 },

  { type: "sofa", label: "Sofa", category: "Living", width: 165, height: 75 },
  { type: "armchair", label: "Armchair", category: "Living", width: 72, height: 72 },
  { type: "coffee_table", label: "Coffee table", category: "Living", width: 100, height: 55 },
  { type: "side_table", label: "Side table", category: "Living", width: 45, height: 45 },
  { type: "dining_table", label: "Dining table", category: "Living", width: 150, height: 85 },
  { type: "dining_chair", label: "Dining chair", category: "Living", width: 40, height: 40 },
  { type: "tv_stand", label: "TV stand", category: "Living", width: 125, height: 35 },
  { type: "bookshelf", label: "Bookshelf", category: "Living", width: 95, height: 30 },

  { type: "bed", label: "Double bed", category: "Bedroom", width: 150, height: 205 },
  { type: "wardrobe", label: "Wardrobe", category: "Bedroom", width: 125, height: 58 },
  { type: "chest_drawers", label: "Chest of drawers", category: "Bedroom", width: 88, height: 46 },
  { type: "bedside_table", label: "Bedside table", category: "Bedroom", width: 46, height: 46 },
  { type: "dresser", label: "Dressing table", category: "Bedroom", width: 105, height: 48 },

  { type: "kitchen_counter", label: "Kitchen counter", category: "Kitchen", width: 190, height: 62 },
  { type: "kitchen_island", label: "Kitchen island", category: "Kitchen", width: 155, height: 82 },
  { type: "sink", label: "Kitchen sink", category: "Kitchen", width: 72, height: 52 },
  { type: "oven", label: "Oven", category: "Kitchen", width: 60, height: 60 },
  { type: "hob", label: "Hob", category: "Kitchen", width: 65, height: 55 },
  { type: "fridge", label: "Fridge", category: "Kitchen", width: 65, height: 65 },
  { type: "freezer", label: "Freezer", category: "Kitchen", width: 65, height: 65 },
  { type: "dishwasher", label: "Dishwasher", category: "Kitchen", width: 60, height: 60 },
  { type: "microwave", label: "Microwave", category: "Kitchen", width: 55, height: 42 },

  { type: "toilet", label: "Toilet", category: "Bathroom", width: 48, height: 70 },
  { type: "bath", label: "Bath", category: "Bathroom", width: 170, height: 75 },
  { type: "shower", label: "Shower", category: "Bathroom", width: 85, height: 85 },
  { type: "sink", label: "Basin", category: "Bathroom", width: 66, height: 46 },
  { type: "vanity", label: "Vanity unit", category: "Bathroom", width: 90, height: 50 },

  { type: "desk", label: "Desk", category: "Office", width: 135, height: 68 },
  { type: "office_chair", label: "Office chair", category: "Office", width: 52, height: 52 },
  { type: "cabinet", label: "Filing cabinet", category: "Office", width: 55, height: 45 },
  { type: "bookshelf", label: "Office shelving", category: "Office", width: 100, height: 32 },

  { type: "washing_machine", label: "Washing machine", category: "Utility", width: 62, height: 62 },
  { type: "dryer", label: "Tumble dryer", category: "Utility", width: 62, height: 62 },
  { type: "storage_unit", label: "Storage unit", category: "Utility", width: 110, height: 48 },
  { type: "freezer", label: "Chest freezer", category: "Utility", width: 105, height: 62 },
  { type: "boiler", label: "Boiler", category: "Utility", width: 55, height: 45 },

  { type: "patio_table", label: "Patio table", category: "Outdoor", width: 110, height: 80 },
  { type: "garden_chair", label: "Garden chair", category: "Outdoor", width: 45, height: 45 },
  { type: "barbecue", label: "Barbecue", category: "Outdoor", width: 75, height: 45 },
  { type: "plant", label: "Large plant", category: "Outdoor", width: 45, height: 45 },

  { type: "rug", label: "Rug", category: "Decor", width: 160, height: 105 },
  { type: "plant", label: "Plant", category: "Decor", width: 38, height: 38 },
  { type: "lamp", label: "Floor lamp", category: "Decor", width: 32, height: 32 },
  { type: "label", label: "Text label", category: "Decor", width: 130, height: 36 },
];

export const paletteCategories: PaletteCategory[] = [
  "Structure",
  "Living",
  "Bedroom",
  "Kitchen",
  "Bathroom",
  "Office",
  "Utility",
  "Outdoor",
  "Decor",
];
