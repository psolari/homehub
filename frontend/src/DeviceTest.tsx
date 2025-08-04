import { useEffect } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import {
  fetchDevices,
  createDevice,
  updateDevice,
  deleteDevice,
  type Device,
} from './redux/slices/devicesSlice';
import type { RootState, AppDispatch } from './redux/store';

const DeviceTest = () => {
  const dispatch = useDispatch<AppDispatch>();
  const { devices, loading, error } = useSelector((state: RootState) => state.devices);

  useEffect(() => {
    dispatch(fetchDevices());
  }, [dispatch]);

  const handleCreate = () => {
    const dummyDevice: Partial<Device> = {
      name: 'Test Device',
      description: 'Just for testing',
      device_type: 'test_type',
      status: 'on',
      floorplan_object_id: 'abc123',
      credentials: {},
      config_schema: {},
      metadata: {},
    };
    dispatch(createDevice(dummyDevice));
  };

  const handleUpdate = () => {
    if (devices.length === 0) return;
    const first = devices[0];
    dispatch(updateDevice({ id: first.id, name: `${first.name} (Updated)` }));
  };

  const handleDelete = () => {
    if (devices.length === 0) return;
    dispatch(deleteDevice(devices[0].id));
  };

  if (loading) return <p>Loading devices...</p>;
  if (error) return <p>Error: {error}</p>;

  return (
    <div>
      <h2>Devices</h2>
      <button onClick={handleCreate}>Create Dummy Device</button>
      <button onClick={handleUpdate}>Update First Device</button>
      <button onClick={handleDelete}>Delete First Device</button>
      {devices.length === 0 ? (
        <p>No devices found.</p>
      ) : (
        <ul>
          {devices.map((device) => (
            <li key={device.id}>
              <strong>{device.name}</strong> — {device.status}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default DeviceTest;
