import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';
import ApiService from '../../api/ApiService';

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

type DevicesState = {
  devices: Device[];
  selectedDevice: Device | null;
  loading: boolean;
  error: string | null;
};

const initialState: DevicesState = {
  devices: [],
  selectedDevice: null,
  loading: false,
  error: null,
};

export const fetchDevices = createAsyncThunk(
  "devices/fetchAll",
  async (_, thunkAPI) => {
    try {
      const res = await ApiService.request("GET", "/devices/");
      return res;
    } catch (err: unknown) {
      if (err instanceof Error) {
        return thunkAPI.rejectWithValue(err.message);
      }
      return thunkAPI.rejectWithValue("Unknown error");
    }
    
  }
);

export const fetchDeviceById = createAsyncThunk(
  "devices/fetchOne",
  async (id: string, thunkAPI) => {
    try {
      const res = await ApiService.request("GET", `/devices/${id}/`);
      return res.data;
    } catch (err: unknown) {
      if (err instanceof Error) {
        return thunkAPI.rejectWithValue(err.message);
      }
      return thunkAPI.rejectWithValue("Unknown error");
    }
    
  }
);

export const createDevice = createAsyncThunk(
  "devices/create",
  async (payload: Partial<Device>, thunkAPI) => {
    try {
      const res = await ApiService.request("POST", "/devices/", payload);
      return res.data;
    } catch (err: unknown) {
      if (err instanceof Error) {
        return thunkAPI.rejectWithValue(err.message);
      }
      return thunkAPI.rejectWithValue("Unknown error");
    }
    
  }
);

export const updateDevice = createAsyncThunk(
  "devices/update",
  async ({ id, ...payload }: Partial<Device> & { id: string }, thunkAPI) => {
    try {
      const res = await ApiService.request("PATCH", `/devices/${id}/`, payload);
      return res.data;
    } catch (err: unknown) {
      if (err instanceof Error) {
        return thunkAPI.rejectWithValue(err.message);
      }
      return thunkAPI.rejectWithValue("Unknown error");
    }
    
  }
);

export const deleteDevice = createAsyncThunk(
  "devices/delete",
  async (id: string, thunkAPI) => {
    try {
      await ApiService.request("DELETE", `/devices/${id}/`);
      return id;
    } catch (err: unknown) {
      if (err instanceof Error) {
        return thunkAPI.rejectWithValue(err.message);
      }
      return thunkAPI.rejectWithValue("Unknown error");
    }
    
  }
);

// --- Slice ---

const devicesSlice = createSlice({
  name: "devices",
  initialState,
  reducers: {
    setSelectedDevice(state, action: PayloadAction<Device | null>) {
      state.selectedDevice = action.payload;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchDevices.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchDevices.fulfilled, (state, action) => {
        state.devices = Array.isArray(action.payload) ? action.payload : [];
        state.loading = false;
      })
      .addCase(fetchDevices.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload as string;
      })

      .addCase(fetchDeviceById.fulfilled, (state, action) => {
        state.selectedDevice = action.payload;
      })

      .addCase(createDevice.fulfilled, (state, action) => {
        state.devices.push(action.payload);
      })

      .addCase(updateDevice.fulfilled, (state, action) => {
        const index = state.devices.findIndex(d => d.id === action.payload.id);
        if (index !== -1) state.devices[index] = action.payload;
      })

      .addCase(deleteDevice.fulfilled, (state, action) => {
        state.devices = state.devices.filter(d => d.id !== action.payload);
        if (state.selectedDevice?.id === action.payload) {
          state.selectedDevice = null;
        }
      });
  },
});

export const { setSelectedDevice } = devicesSlice.actions;
export default devicesSlice.reducer;
