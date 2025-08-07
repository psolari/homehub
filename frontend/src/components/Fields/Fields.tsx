import "../../styles/custom-checkbox.css"; // Custom checkbox styles

type FieldsProps = {
  type?: string;
  label?: string;
  help_text?: string;
  max_length?: number;
  input?: string;
  onChange?: (value: string) => void;
  choices?: { value: string; display_name: string }[];
};

const noop = () => {};

export const Fields = ({
  type = "",
  label = "",
  help_text = "",
  max_length = 255,
  input = "",
  onChange = noop,
  choices = [] as { value: string; display_name: string }[],
}: FieldsProps) => {
  return (
    <div className="field-container text-gray-300">
      {type === "string" ? (
        <div className="flex justify-between h-9 items-center">
          <label className="field-label">{label}</label>
          <input
            type={type}
            className="field-input bg-black text-white border border-gray-600 rounded px-2 py-1"
            maxLength={max_length}
            value={input}
            onChange={(e) => onChange(e.target.value)} // use onChange
          />
        </div>
      ) : type === "number" ? (
        <div className="flex justify-between h-9 items-center">
          <label className="field-label">{label}</label>
          <input
            type={type}
            className="field-input"
            maxLength={max_length}
            value={input}
            onChange={(e) => onChange(e.target.value)} // use onChange
          />
        </div>
      ) : type === "boolean" ? (
        <div className="flex justify-between h-9 items-center">
          <label className="field-label">{label}</label>
          <input
            type="checkbox"
            className="custom-checkbox"
            checked={input === "true"}
            onChange={(e) => onChange(e.target.checked.toString())} // use onChange
          />
        </div>
      ) : type === "choice" ? (
        <div className="flex justify-between h-9 items-center">
          <label className="field-label">{label}</label>
          <select
            className="bg-gray-800 rounded-md border border-gray-600 text-gray-300 px-2 py-1"
            value={input}
            onChange={(e) => onChange(e.target.value)} // use onChange
          >
            <option value="">Select...</option>
            {choices.map(({ value, display_name }) => (
              <option key={value} value={value}>
                {display_name}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <div className="flex justify-between h-9 items-center">
          <label className="field-label">{label}</label>
          {help_text && <span className="field-help-text">{help_text}</span>}
          <input
            type={type}
            className="field-input"
            maxLength={max_length}
            value={input}
            onChange={(e) => onChange(e.target.value)} // use onChange
          />
        </div>
      )}
    </div>
  );
};
