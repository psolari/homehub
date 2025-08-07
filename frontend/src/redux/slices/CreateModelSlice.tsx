import {
  createSlice,
  createAsyncThunk,
  createEntityAdapter,
} from "@reduxjs/toolkit";
import type { ActionReducerMapBuilder, EntityState } from "@reduxjs/toolkit";
import { toast } from "react-toastify";

import { ApiError } from "../../api/ApiError";
import { ApiService } from "../../api/ApiService";
import { logout } from "./AuthSlice";

export type GenericModel = {
  modelName: string;
  endpoint: string;
  permissions?: Record<string, string>;
  hiddenFields?: string[];
  additionalReducers?: (builder: ActionReducerMapBuilder<unknown>) => void;
};

export function createModelSlice<T extends { id: string }>({
  modelName,
  endpoint,
  permissions,
  hiddenFields,
  additionalReducers,
}: GenericModel) {
  const entityAdapter = createEntityAdapter<T>();
  const initialState = entityAdapter.getInitialState({
    selectedId: "",
    selectedRow: null,
    count: 0,
    options: {
      data: {},
      loading: false,
      error: null as string | null,
    },
    viewPermission: permissions?.view || "",
    addPermission: permissions?.add || "",
    changePermission: permissions?.change || "",
    deletePermission: permissions?.delete || "",
    hiddenFields: hiddenFields || [],
    detail: {
      loading: false,
      error: null as string | null,
    },
    list: {
      loading: false,
      error: null as string | null,
    },
  });

  const getOptionsThunk = createAsyncThunk(
    `${modelName}/getOptions`,
    async (_, { rejectWithValue }) => {
      try {
        const response = await ApiService.request("OPTIONS", `${endpoint}/`);
        return response;
      } catch (error) {
        if (error instanceof ApiError) {
          return rejectWithValue(error.responseData || error.message);
        } else if (error instanceof Error) {
          return rejectWithValue(error.message);
        }
        return rejectWithValue("Unknown error");
      }
    },
  );

  const getListThunk = createAsyncThunk(
    `${modelName}/getList`,
    async (_, { rejectWithValue }) => {
      try {
        const response = await ApiService.request("GET", `${endpoint}/`);
        return response;
      } catch (error) {
        if (error instanceof ApiError) {
          return rejectWithValue(error.responseData || error.message);
        } else if (error instanceof Error) {
          return rejectWithValue(error.message);
        }
        return rejectWithValue("Unknown error");
      }
    },
  );

  const getOneThunk = createAsyncThunk(
    `${modelName}/getOne`,
    async (id: string, { rejectWithValue }) => {
      try {
        const response = await ApiService.request("GET", `${endpoint}/${id}/`);
        return response;
      } catch (error) {
        if (error instanceof ApiError) {
          return rejectWithValue(error.responseData || error.message);
        } else if (error instanceof Error) {
          return rejectWithValue(error.message);
        }
        return rejectWithValue("Unknown error");
      }
    },
  );

  const createOneThunk = createAsyncThunk(
    `${modelName}/createOne`,
    async (data: Record<string, unknown>, { rejectWithValue }) => {
      try {
        const response = await ApiService.request("POST", `${endpoint}/`, data);
        return response;
      } catch (error) {
        if (error instanceof ApiError) {
          return rejectWithValue(error.responseData || error.message);
        } else if (error instanceof Error) {
          return rejectWithValue(error.message);
        }
        return rejectWithValue("Unknown error");
      }
    },
  );

  const updateOneThunk = createAsyncThunk(
    `${modelName}/updateOne`,
    async (
      { id, data }: { id: string; data: Record<string, unknown> },
      { rejectWithValue },
    ) => {
      try {
        const response = await ApiService.request(
          "PATCH",
          `${endpoint}/${id}/`,
          data,
        );
        return response;
      } catch (error) {
        if (error instanceof ApiError) {
          return rejectWithValue(error.responseData || error.message);
        } else if (error instanceof Error) {
          return rejectWithValue(error.message);
        }
        return rejectWithValue("Unknown error");
      }
    },
  );

  const deleteOneThunk = createAsyncThunk(
    `${modelName}/deleteOne`,
    async (id: string, { rejectWithValue }) => {
      try {
        await ApiService.request("DELETE", `${endpoint}/${id}/`);
        return id;
      } catch (error) {
        if (error instanceof ApiError) {
          return rejectWithValue(error.responseData || error.message);
        } else if (error instanceof Error) {
          return rejectWithValue(error.message);
        }
        return rejectWithValue("Unknown error");
      }
    },
  );

  const slice = createSlice({
    name: modelName,
    initialState,
    reducers: {
      setSelectedId(state, action) {
        state.selectedId = action.payload;
      },
      setSelectedRow(state, action) {
        state.selectedRow = action.payload;
      },
      clearSelectedRow(state) {
        state.selectedRow = null;
      },
    },
    extraReducers: (builder) => {
      builder
        .addCase(getOptionsThunk.pending, (state) => {
          state.options.loading = true;
          state.options.error = null;
        })
        .addCase(getOptionsThunk.fulfilled, (state, action) => {
          state.options.data = action.payload;
          state.options.loading = false;
          state.options.error = null;
        })
        .addCase(getOptionsThunk.rejected, (state, action) => {
          state.options.loading = false;
          state.options.error = action.payload as string;
          toast.error(`Failed to fetch options: ${action.payload}`);
        })
        .addCase(getListThunk.pending, (state) => {
          state.list.loading = true;
          state.list.error = null;
        })
        .addCase(getListThunk.fulfilled, (state, action) => {
          entityAdapter.setAll(state, action.payload);
          state.list.loading = false;
          state.list.error = null;
          state.count = (action.payload as T[]).length; // optional
        })
        .addCase(getListThunk.rejected, (state, action) => {
          state.list.loading = false;
          state.list.error = action.payload as string;
          toast.error(`Failed to fetch list: ${action.payload}`);
        })
        .addCase(getOneThunk.pending, (state) => {
          state.detail.loading = true;
          state.detail.error = null;
        })
        .addCase(getOneThunk.fulfilled, (state, action) => {
          entityAdapter.upsertOne(state, action.payload);
          state.detail.loading = false;
          state.detail.error = null;
        })
        .addCase(getOneThunk.rejected, (state, action) => {
          state.detail.loading = false;
          state.detail.error = action.payload as string;
          toast.error(`Failed to fetch detail: ${action.payload}`);
        })
        .addCase(createOneThunk.pending, (state) => {
          state.options.loading = true;
          state.options.error = null;
        })
        .addCase(createOneThunk.fulfilled, (state, action) => {
          entityAdapter.addOne(state, action.payload);
          state.options.loading = false;
          state.options.error = null;
          toast.success(`${modelName} created successfully`);
        })
        .addCase(createOneThunk.rejected, (state, action) => {
          state.options.loading = false;
          state.options.error = action.payload as string;
          toast.error(`Failed to create ${modelName}: ${action.payload}`);
        })
        .addCase(updateOneThunk.pending, (state) => {
          state.options.loading = true;
          state.options.error = null;
        })
        .addCase(updateOneThunk.fulfilled, (state, action) => {
          entityAdapter.upsertOne(state, action.payload);
          state.options.loading = false;
          state.options.error = null;
          toast.success(`${modelName} updated successfully`);
        })
        .addCase(updateOneThunk.rejected, (state, action) => {
          state.options.loading = false;
          state.options.error = action.payload as string;
          toast.error(`Failed to update ${modelName}: ${action.payload}`);
        })
        .addCase(deleteOneThunk.pending, (state) => {
          state.options.loading = true;
          state.options.error = null;
        })
        .addCase(deleteOneThunk.fulfilled, (state, action) => {
          entityAdapter.removeOne(state, action.payload);
          state.options.loading = false;
          state.options.error = null;
          toast.success(`${modelName} deleted successfully`);
        })
        .addCase(deleteOneThunk.rejected, (state, action) => {
          state.options.loading = false;
          state.options.error = action.payload as string;
          toast.error(`Failed to delete ${modelName}: ${action.payload}`);
        })
        .addCase(logout.fulfilled, () => {
          return initialState; // Reset state on logout
        });
      additionalReducers?.(builder);
    },
  });

  return {
    entityAdapter,
    slice: slice.reducer,
    reducer: slice.reducer,
    actions: {
      ...slice.actions,
      getOptions: getOptionsThunk,
      getList: getListThunk,
      getOne: getOneThunk,
      createOne: createOneThunk,
      updateOne: updateOneThunk,
      deleteOne: deleteOneThunk,
    },
    selectors: entityAdapter.getSelectors(
      (state: unknown) =>
        (state as Record<string, EntityState<T, string>>)[modelName],
    ),
  };
}
