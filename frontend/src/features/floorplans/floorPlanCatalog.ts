import type { FloorPlanObjectType } from "../../shared/types";

export type PaletteItem = {
  type: FloorPlanObjectType;
  label: string;
  category: "Structure" | "Living" | "Bedroom" | "Kitchen" | "Bathroom" | "Office" | "Decor";
  width: number;
  height: number;
};

export const floorPlanPalette: PaletteItem[] = [
  { type: "wall", label: "Wall", category: "Structure", width: 180, height: 12 },
  { type: "door", label: "Door", category: "Structure", width: 90, height: 12 },
  { type: "window", label: "Window", category: "Structure", width: 100, height: 10 },
  { type: "stairs", label: "Stairs", category: "Structure", width: 130, height: 90 },
  { type: "column", label: "Column", category: "Structure", width: 30, height: 30 },
  { type: "radiator", label: "Radiator", category: "Structure", width: 90, height: 22 },
  { type: "fireplace", label: "Fireplace", category: "Structure", width: 100, height: 35 },

  { type: "sofa", label: "Sofa", category: "Living", width: 150, height: 70 },
  { type: "armchair", label: "Armchair", category: "Living", width: 70, height: 70 },
  { type: "coffee_table", label: "Coffee table", category: "Living", width: 95, height: 55 },
  { type: "dining_table", label: "Dining table", category: "Living", width: 140, height: 80 },
  { type: "dining_chair", label: "Dining chair", category: "Living", width: 38, height: 38 },
  { type: "tv_stand", label: "TV stand", category: "Living", width: 120, height: 35 },
  { type: "bookshelf", label: "Bookshelf", category: "Living", width: 90, height: 30 },

  { type: "bed", label: "Bed", category: "Bedroom", width: 140, height: 200 },
  { type: "wardrobe", label: "Wardrobe", category: "Bedroom", width: 120, height: 55 },
  { type: "chest_drawers", label: "Chest of drawers", category: "Bedroom", width: 85, height: 45 },
  { type: "bedside_table", label: "Bedside table", category: "Bedroom", width: 45, height: 45 },

  { type: "kitchen_counter", label: "Kitchen counter", category: "Kitchen", width: 180, height: 60 },
  { type: "kitchen_island", label: "Kitchen island", category: "Kitchen", width: 150, height: 80 },
  { type: "sink", label: "Sink", category: "Kitchen", width: 70, height: 50 },
  { type: "appliance", label: "Appliance", category: "Kitchen", width: 60, height: 60 },

  { type: "toilet", label: "Toilet", category: "Bathroom", width: 45, height: 65 },
  { type: "bath", label: "Bath", category: "Bathroom", width: 160, height: 70 },
  { type: "shower", label: "Shower", category: "Bathroom", width: 80, height: 80 },
  { type: "sink", label: "Basin", category: "Bathroom", width: 65, height: 45 },

  { type: "desk", label: "Desk", category: "Office", width: 130, height: 65 },
  { type: "office_chair", label: "Office chair", category: "Office", width: 50, height: 50 },
  { type: "cabinet", label: "Cabinet", category: "Office", width: 80, height: 40 },

  { type: "rug", label: "Rug", category: "Decor", width: 150, height: 100 },
  { type: "plant", label: "Plant", category: "Decor", width: 38, height: 38 },
  { type: "lamp", label: "Lamp", category: "Decor", width: 30, height: 30 },
  { type: "label", label: "Text label", category: "Decor", width: 120, height: 35 },
];

export const paletteCategories = ["Structure", "Living", "Bedroom", "Kitchen", "Bathroom", "Office", "Decor"] as const;
