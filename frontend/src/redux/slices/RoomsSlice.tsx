import { createModelSlice } from "./CreateModelSlice";

export type Rooms = {
  id: string;
  name: string;
  description: string;
  floor_plan: string;
};

const roomsSlice = createModelSlice<Rooms>({
  modelName: "rooms",
  endpoint: "/rooms",
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

export default roomsSlice.slice;
export const roomsActions = roomsSlice.actions;
export const roomsSelectors = roomsSlice.selectors;
