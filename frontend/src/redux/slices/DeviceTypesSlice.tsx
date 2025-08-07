import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import { ApiService } from "../../api/ApiService";
import { logout } from "./AuthSlice";
import type { RootState } from "../store";

export type DeviceTypeField = {
  name: string;
  type: string;
  required: boolean;
  description: string;
  read_only?: boolean;
  hidden?: boolean;
};

export type DeviceType = {
  type: string;
  display_name: string;
  fields: DeviceTypeField[];
  description?: string;
  config_schema?: Record<string, unknown>;
  icon?: string;
};

type DeviceTypesState = {
  entities: Record<string, DeviceType>;
  loading: boolean;
  error: string | null;
};

const initialState: DeviceTypesState = {
  entities: {},
  loading: false,
  error: null,
};

export const fetchDeviceTypes = createAsyncThunk(
  "deviceTypes/fetchDeviceTypes",
  async (_, { rejectWithValue }) => {
    try {
      const response = await ApiService.request("GET", "/device-types/");
      return response as DeviceType[];
    } catch (error) {
      return rejectWithValue(error || "Failed to load device types");
    }
  },
);

const deviceTypesSlice = createSlice({
  name: "deviceTypes",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchDeviceTypes.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchDeviceTypes.fulfilled, (state, action) => {
        state.loading = false;
        const types: DeviceType[] = action.payload;
        state.entities = Object.fromEntries(types.map((t) => [t.type, t]));
      })
      .addCase(fetchDeviceTypes.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload as string;
      })
      .addCase(logout.fulfilled, () => {
        return initialState; // Reset state on logout
      });
  },
});

export default deviceTypesSlice.reducer;

export const selectAllDeviceTypes = (state: RootState) =>
  Object.values(state.deviceTypes.entities);
export const selectDeviceTypeById = (id: string) => (state: RootState) =>
  state.deviceTypes.entities[id];
export const selectDeviceTypesLoading = (state: RootState) =>
  state.deviceTypes.loading;
