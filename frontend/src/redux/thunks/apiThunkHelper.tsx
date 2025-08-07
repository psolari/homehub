// src/redux/thunks/apiThunkHelper.ts
import { refreshAccessToken, selectAccessToken } from "../slices/AuthSlice";
import { isTokenExpired } from "../../utils/Token";
import { ApiService } from "../../api/ApiService";
import type { AppDispatch, RootState } from "../store";

export async function callApiWithAuth(
  dispatch: AppDispatch,
  getState: () => RootState,
  endpoint: string,
  method: string = "GET",
  body: object | null = null,
) {
  let token = selectAccessToken(getState());

  if (!token || isTokenExpired(token)) {
    const refreshResult = await dispatch(refreshAccessToken());

    if (refreshAccessToken.fulfilled.match(refreshResult)) {
      token = refreshResult.payload.access;
    } else {
      throw new Error("Session expired. Please log in again.");
    }
  }

  return ApiService.request(method, endpoint, body, {
    Authorization: `Bearer ${token}`,
  });
}
