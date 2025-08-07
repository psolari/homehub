import { useState, useEffect, useCallback } from "react"; // added useCallback
import { useSelector } from "react-redux";
import { useAppDispatch } from "../../utils/UseAppDispatch";
import type { RootState } from "../../redux/store";
import GenericModal from "./GenericModal";
import { devicesActions } from "../../redux/slices/DevicesSlice";
import { Fields } from "../Fields/Fields";

type PostField = {
  type: string;
  required: boolean;
  read_only: boolean;
  label: string;
  help_text?: string;
  max_length?: number;
  choices?: { value: string; display_name: string }[];
  hidden?: boolean;
};

type DeviceOptionsData = {
  actions: {
    POST: Record<string, PostField>;
  };
};

const AddDeviceModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
}> = ({ isOpen, onClose }) => {
  const dispatch = useAppDispatch();
  const deviceTypes = useSelector(
    (state: RootState) => state.deviceTypes.entities,
  );
  const devices = useSelector(
    (state: RootState) => state.devices.options.data,
  ) as DeviceOptionsData;

  // Safely cast devices as DeviceOptionsData
  const postFields: [string, PostField][] = devices?.actions?.POST
    ? Object.entries((devices as DeviceOptionsData).actions.POST)
    : [];

  const [selectedType, setSelectedType] = useState<string>("");
  const [formValues, setFormValues] = useState<Record<string, string>>({});

  useEffect(() => {
    if (selectedType && deviceTypes[selectedType]) {
      const init: Record<string, string> = {};
      deviceTypes[selectedType].fields.forEach((f) => {
        init[f.name] = "";
      });
      setFormValues(init);
    } else {
      setFormValues({});
    }
  }, [selectedType, deviceTypes]);

  const handleChange = (name: string, value: string) => {
    setFormValues((prev) => ({ ...prev, [name]: value }));
  };

  const handleClose = useCallback(() => {
    setSelectedType("");
    setFormValues({});
    onClose();
  }, [onClose]);

  // new: close on ESC
  useEffect(() => {
    console.log("AddDeviceModal useEffect for ESC key");
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen, handleClose]);

  const handleAddDevice = async () => {
    if (!selectedType) return;
    try {
      // split formValues into root vs. config based on device-specific field names
      const configFieldNames = new Set(
        deviceTypes[selectedType].fields.map((f) => f.name),
      );
      const rootValues: Record<string, string> = {};
      const configValues: Record<string, string> = {};
      Object.entries(formValues).forEach(([key, value]) => {
        if (configFieldNames.has(key)) {
          configValues[key] = value;
        } else {
          rootValues[key] = value;
        }
      });

      await dispatch(
        devicesActions.createOne({
          device_type: selectedType,
          ...rootValues,
          config: configValues,
        }),
      ).unwrap();
      handleClose();
    } catch (error) {
      console.error("Error adding device:", error);
    }
  };

  return (
    <GenericModal isOpen={isOpen} onClose={handleClose} width={"w-1/3"}>
      <div className="p-4">
        <h2 className="text-lg text-white font-bold mb-4">Add Device</h2>
        <div className="mb-4">
          <Fields
            type="choice"
            label="Device Type"
            help_text="Select the type of device you want to add."
            input={selectedType}
            onChange={(value) => setSelectedType(value)}
            choices={Object.keys(deviceTypes).map((type) => ({
              value: type,
              display_name: deviceTypes[type].display_name,
            }))}
          />
        </div>
        {/* Generic POST fields */}{" "}
        {selectedType && deviceTypes[selectedType] && (
          <>
            <div className="mb-4">
              {postFields
                .filter(([, field]) => !field.hidden)
                .map(([key, field]) => (
                  <div key={key} className="mb-2">
                    <Fields
                      type={field.type}
                      label={field.label}
                      help_text={field.help_text}
                      max_length={field.max_length}
                      input={formValues[key] || ""}
                      onChange={(value) => handleChange(key, value)} // added
                    />
                  </div>
                ))}
            </div>

            {/* Device-specific fields */}
            <div className="mb-4">
              {deviceTypes[selectedType].fields
                .filter((field) => !field.hidden)
                .map((field) => (
                  <div key={field.name} className="mb-2">
                    <Fields
                      type={field.type}
                      label={field.name}
                      input={formValues[field.name] || ""}
                      onChange={(value) => handleChange(field.name, value)} // added
                    />
                  </div>
                ))}
            </div>
          </>
        )}
        <button
          className="bg-blue-500 text-white px-4 py-2 rounded"
          onClick={handleAddDevice}
          disabled={!selectedType}
        >
          Add Device
        </button>
      </div>
    </GenericModal>
  );
};

export default AddDeviceModal;
