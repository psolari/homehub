import { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import type { RootState, AppDispatch } from './redux/store';
import {
  devicesActions,
  devicesSelectors,
} from './redux/slices/DevicesSlice';
import type { Device } from './redux/slices/DevicesSlice';

const DeviceTest = () => {
  const dispatch = useDispatch<AppDispatch>();

  const devices = useSelector(devicesSelectors.selectAll);
  const loading = useSelector(
    (state: RootState) => (state.devices as any).list.loading
  );
  const error = useSelector(
    (state: RootState) => (state.devices as any).list.error
  );

  useEffect(() => {
    dispatch(devicesActions.getList());
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
    dispatch(devicesActions.createOne(dummyDevice));
  };

  const handleUpdate = () => {
    if (devices.length === 0) return;
    const first = devices[0];
    dispatch(devicesActions.updateOne({ id: first.id, data: { name: `${first.name} (Updated)` } }));
  };

  const handleDelete = () => {
    if (devices.length === 0) return;
    dispatch(devicesActions.deleteOne(devices[0].id));
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
