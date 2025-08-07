import { useEffect } from "react";
import { useAppDispatch } from "../utils/UseAppDispatch";
import { fetchDeviceTypes } from "../redux/slices/DeviceTypesSlice";
import { devicesActions } from "../redux/slices/DevicesSlice";
import { floorPlansActions } from "../redux/slices/FloorPlansSlice";
import { roomsActions } from "../redux/slices/RoomsSlice";
import { useSelector } from "react-redux";
import { selectAccessToken } from "../redux/slices/AuthSlice";

export default function AppInitialiser() {
  const dispatch = useAppDispatch();
  const accessToken = useSelector(selectAccessToken);

  useEffect(() => {
    const alreadyInitialised = sessionStorage.getItem("appInitialised");

    if (accessToken && !alreadyInitialised) {
      dispatch(devicesActions.getOptions());
      dispatch(fetchDeviceTypes());
      dispatch(floorPlansActions.getOptions());
      dispatch(roomsActions.getOptions());

      sessionStorage.setItem("appInitialised", "true");
    }
  }, [accessToken, dispatch]);

  return null;
}
