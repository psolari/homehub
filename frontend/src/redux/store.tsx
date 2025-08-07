import { configureStore } from "@reduxjs/toolkit";
import { persistStore, persistReducer } from "redux-persist";
import storage from "redux-persist/lib/storage"; // defaults to localStorage for web
import { combineReducers } from "redux";

import authSlice from "./slices/AuthSlice";
import devicesSlice from "./slices/DevicesSlice";
import deviceTypesSlice from "./slices/DeviceTypesSlice";
import floorPlanSlice from "./slices/FloorPlansSlice";
import roomsSlice from "./slices/RoomsSlice";

const persistConfig = {
  key: "root",
  storage,
  whitelist: ["auth", "devices", "deviceTypes", "floorplans", "rooms"],
};

const rootReducer = combineReducers({
  auth: authSlice,
  devices: devicesSlice,
  deviceTypes: deviceTypesSlice,
  floorplans: floorPlanSlice,
  rooms: roomsSlice,
});

const persistedReducer = persistReducer(persistConfig, rootReducer);

export const store = configureStore({
  reducer: persistedReducer,
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: false,
    }),
});

export const persistor = persistStore(store);
export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
