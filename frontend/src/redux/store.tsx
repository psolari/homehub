import { configureStore } from '@reduxjs/toolkit';
import authSlice from './slices/AuthSlice';
import devicesSlice from './slices/DevicesSlice';

export const store = configureStore({
  reducer: {
    auth: authSlice,
    devices: devicesSlice,
  },
});

export type RootState = ReturnType<typeof store.getState> & {
  [key: string]: unknown;
};
export type AppDispatch = typeof store.dispatch;