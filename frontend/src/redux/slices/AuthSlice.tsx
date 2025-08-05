// src/redux/slices/authSlice.ts
import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import { setCookie, getCookie, deleteCookie } from "../../utils/Cookie";
import UnAuthApiService from "../../api/UnAuthApiService";
import { decodePayload, isTokenExpired } from "../../utils/Token";
import { ApiError } from "../../api/ApiError";
import type { RootState } from "../store";

// Types
export type AuthState = {
  accessToken: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  isPending: boolean;
  isRejected: boolean;
  error: string | null;
  user: string | null;
};

const initialState: AuthState = {
  accessToken: getCookie("accessToken"),
  refreshToken: getCookie("refreshToken"),
  isAuthenticated: !!getCookie("accessToken"),
  isPending: false,
  isRejected: false,
  error: null,
  user: null,
};

// Async thunks
export const login = createAsyncThunk<
  { access: string; refresh: string },
  { username: string; password: string },
  { rejectValue: string }
>("auth/login", async ({ username, password }, { rejectWithValue }) => {
  try {
    const response = await UnAuthApiService.request(
      "POST",
      "/token/",
      { username, password },
      {}
    );
    const access = response.access;
    const refresh = response.refresh;

    // Save cookies with expiry
    const decodedAccessPayload = decodePayload(access);
    if (decodedAccessPayload) setCookie("accessToken", access, decodedAccessPayload.exp);
    const decodedRefreshPayload = decodePayload(refresh);
    if (decodedRefreshPayload) setCookie("refreshToken", refresh, decodedRefreshPayload.exp);

    return { access, refresh };
  } catch (error) {
    if (error instanceof ApiError) return rejectWithValue(error.message);
    if (error instanceof Error) return rejectWithValue(error.message);
    return rejectWithValue("Unknown error");
  }
});

export const logout = createAsyncThunk("auth/logout", async (_, { dispatch }) => {
  dispatch(authSlice.actions.clearAuthState());
  deleteCookie("accessToken");
  deleteCookie("refreshToken");
  deleteCookie("sessionid");
  window.location.href = "/login";
  return {};
});

export const refreshAccessToken = createAsyncThunk<
  { access: string },
  void,
  { state: RootState; rejectValue: string }
>("auth/refreshAccessToken", async (_, { getState, rejectWithValue, dispatch }) => {
  const state = getState();
  const refreshToken = state.auth.refreshToken;

  if (!refreshToken || isTokenExpired(refreshToken)) {
    dispatch(logout());
    return rejectWithValue("Refresh token expired");
  }

  try {
    const response = await UnAuthApiService.request(
      "POST",
      "/token/refresh/",
      { refresh: refreshToken },
      {}
    );

    const access = response.access;
    const decodedAccessPayload = decodePayload(access);
    if (decodedAccessPayload) setCookie("accessToken", access, decodedAccessPayload.exp);

    return { access };
  } catch (error) {
    if (error instanceof ApiError) return rejectWithValue(error.message);
    if (error instanceof Error) return rejectWithValue(error.message);
    return rejectWithValue("Unknown error");
  }
});

// Slice
export const authSlice = createSlice({
  name: "auth",
  initialState,
  reducers: {
    clearAuthState(state) {
      state.accessToken = null;
      state.refreshToken = null;
      state.isAuthenticated = false;
      state.error = null;
      state.user = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(login.pending, (state) => {
        state.isPending = true;
        state.isRejected = false;
        state.error = null;
      })
      .addCase(login.fulfilled, (state, action) => {
        state.accessToken = action.payload.access;
        state.refreshToken = action.payload.refresh;
        state.isAuthenticated = true;
        state.isPending = false;
      })
      .addCase(login.rejected, (state, action) => {
        state.isPending = false;
        state.isRejected = true;
        state.error = action.payload ?? "Login failed";
      })
      .addCase(refreshAccessToken.fulfilled, (state, action) => {
        state.accessToken = action.payload.access;
        state.isAuthenticated = true;
      })
      .addCase(logout.fulfilled, (state) => {
        state.accessToken = null;
        state.refreshToken = null;
        state.isAuthenticated = false;
      });
  },
});

export const { clearAuthState } = authSlice.actions;
export const selectAccessToken = (state: RootState) => state.auth.accessToken;
export default authSlice.reducer;
