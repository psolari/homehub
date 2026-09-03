import { useState, useEffect, useCallback } from "react"; // added useCallback
import { useSelector } from "react-redux";
import { useAppDispatch } from "../../utils/UseAppDispatch";
import type { RootState } from "../../redux/store";
import GenericModal from "./GenericModal";
import GenericButton from "../Generic/GenericButton";
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
  const [selectedModel, setSelectedModel] = useState<string>("");

  const [formValues, setFormValues] = useState<Record<string, string>>({});

  const handleChange = (name: string, value: string) => {
    setFormValues((prev) => ({ ...prev, [name]: value }));
  };

  const handleClose = useCallback(() => {
    setSelectedType("");
    setSelectedModel("")
    setFormValues({});
    onClose();
  }, [onClose]);

  // new: close on ESC
  useEffect(() => {
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
        deviceTypes[selectedType][selectedModel].fields.map((f) => f.name),
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
          model: selectedModel,
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
        <h2 className="text-lg text-white font-bold mb-4 border-b border-cyan-500 w-fit">Add Device</h2>
        <div className="mb-2">
          <Fields
            type="choice"
            label="Device Type"
            help_text="Select the type of device you want to add."
            input={selectedType}
            onChange={(value) => (setSelectedModel(""), setSelectedType(value))}
            choices={Object.keys(deviceTypes).map((type) => ({
                value: type,
                display_name: deviceTypes[type].generic.display_name,
              }))}
                    />
        </div>
        {/* Generic POST fields */}{" "}
        {selectedType && deviceTypes[selectedType] && (
          <>
                  <div className="mb-2">
          <Fields
            type="choice"
            label="Device Model"
            help_text="Select the Model of device you want to add."
            input={selectedModel}
            onChange={(value) => setSelectedModel(value)}
            choices={Object.keys(deviceTypes[selectedType]).filter((type) => type !== "generic").map((type) => ({
                value: type,
                display_name: deviceTypes[selectedType][type].display_name,
              }))}
                    />
        </div>
        {selectedModel && (
          <>

            <div className="">
              {postFields
                .filter(([key, field]) => key !== "generic" && !field.hidden)
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
            <div className="">
              {deviceTypes[selectedType][selectedModel].fields
                .filter((field) => !field.hidden)
                .map((field) => (
                  <div key={field.name} className="mb-2">
                    <Fields
                      type={field.type}
                      // label={field.display_name}
                      input={formValues[field.name] || ""}
                      onChange={(value) => handleChange(field.name, value)} // added
                    />
                  </div>
                ))}
            </div>
          </>
              )}</>
        )}
        <div className="flex justify-end">
          <GenericButton
            text="Add Device"
            type="save"
            handleSubmit={handleAddDevice}
            disabled={false}
          />
                  <GenericButton
            text="Cancel"
            type="cancel"
            handleSubmit={handleClose}
            disabled={false}
          />
        </div>
      </div>
    </GenericModal>
  );
};

export default AddDeviceModal;
