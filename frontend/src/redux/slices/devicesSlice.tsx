import { createModelSlice } from "./CreateModelSlice";

export type Device = {
  id: string;
  name: string;
  description: string;
  room: string;
  device_type: string;
  status: string;
  floorplan_object_id: string;
  credentials: object;
  config_schema: object;
  metadata: object;
};

const devicesSlice = createModelSlice<Device>({
  modelName: 'devices',
  endpoint: '/devices',
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

export default devicesSlice.slice;
export const devicesActions = devicesSlice.actions;
export const devicesSelectors = devicesSlice.selectors;
