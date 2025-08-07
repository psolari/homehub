import React, { useEffect } from "react";
import { useSelector } from "react-redux";
import { useAppDispatch } from "../utils/UseAppDispatch";
import type { RootState } from "../redux/store";
import { devicesActions, devicesSelectors } from "../redux/slices/DevicesSlice";

const DevicesPage: React.FC = () => {
  const dispatch = useAppDispatch();
  const devices = useSelector((state: RootState) =>
    devicesSelectors.selectAll(state),
  );

  useEffect(() => {
    dispatch(devicesActions.getList());
  }, [dispatch]);

  const handleDelete = (id: string) => {
    dispatch(devicesActions.deleteOne(id))
      .unwrap()
      .catch((e) => console.error("Failed to delete device:", e));
  };

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold text-white mb-4">Devices</h1>
      <div className="overflow-x-auto bg-gray-800 rounded-lg shadow-lg">
        <table className="min-w-full divide-y divide-gray-700">
          <thead>
            <tr className="bg-gradient-to-r from-indigo-600 to-purple-600">
              <th className="px-6 py-3 text-left text-xs font-medium text-white uppercase tracking-wider">
                Name
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-white uppercase tracking-wider">
                Type
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-white uppercase tracking-wider">
                Status
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-white uppercase tracking-wider">
                Room
              </th>
              <th className="px-6 py-3 text-center text-xs font-medium text-white uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-gray-700 divide-y divide-gray-600">
            {devices.map((d) => (
              <tr key={d.id} className="hover:bg-gray-600">
                <td className="px-6 py-4 text-sm text-white">{d.name}</td>
                <td className="px-6 py-4 text-sm text-white">
                  {d.device_type}
                </td>
                <td className="px-6 py-4 text-sm text-white">{d.status}</td>
                <td className="px-6 py-4 text-sm text-white">{d.room}</td>
                <td className="px-6 py-4 text-sm text-center">
                  <button
                    className="bg-red-500 hover:bg-red-600 text-white px-3 py-1 rounded"
                    onClick={() => handleDelete(d.id)}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {devices.length === 0 && (
              <tr>
                <td
                  colSpan={5}
                  className="px-6 py-4 text-center text-sm text-gray-400"
                >
                  No devices found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default DevicesPage;
