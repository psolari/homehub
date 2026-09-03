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
          <label className="w-1/3 field-label">{label}</label>
          <input
            type={type}
            className="w-2/3 bg-stone-800 text-white rounded px-2 py-1 transition-all transform duration-300 border border-gray-500 hover:border-cyan-500"
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
          <label className="field-label w-1/3">{label}</label>
          <select
            className="w-2/3 bg-stone-800 text-white rounded px-2 py-1 transition-all transform duration-300 border border-gray-500 hover:border-cyan-500"
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
