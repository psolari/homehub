// import { ToastContainer } from 'react-toastify';
import type { RootState } from "../redux/store";
import { useSelector } from "react-redux";
import { Tab, Tabs, TabList, TabPanel } from "react-tabs";

export default function FloorPlanPage() {
  const floorplans = useSelector(
    (state: RootState) => state.floorplans.entities,
  );
  console.log("FloorPlans:", floorplans);

  return (
    <div className="flex">
      <Tabs className="bg-zinc-800 text-gray-100 p-4 rounded shadow-md">
        <TabList className="flex space-x-4 border-b border-zinc-700 mb-4"></TabList>
      </Tabs>
    </div>
  );
}
