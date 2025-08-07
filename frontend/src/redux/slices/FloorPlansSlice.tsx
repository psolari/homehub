import { createModelSlice } from "./CreateModelSlice";

export type FloorPlan = {
  id: string;
  name: string;
  description: string;
  svg_data: string;
};

const floorPlansSlice = createModelSlice<FloorPlan>({
  modelName: "floorplans",
  endpoint: "/floorplans",
  // permissions: {
  //   view: 'devices.view_device',
  //   add: 'devices.add_device',
  //   change: 'devices.change_device',
  //   delete: 'devices.delete_device',
  // },
  // hiddenFields: ['internalCode'],
  // additionalReducers: (builder) => {
  //   // add any device-specific reducers here if needed
  // },
});

export default floorPlansSlice.slice;
export const floorPlansActions = floorPlansSlice.actions;
export const floorPlansSelectors = floorPlansSlice.selectors;
