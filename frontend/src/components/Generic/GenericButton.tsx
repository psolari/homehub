interface GenericButtonProps {
  text: string;
  type: string
  disabled: boolean
  handleSubmit: () => void;
}

const GenericButton: React.FC<GenericButtonProps> = ({
  text,
  type,
  disabled,
  handleSubmit,
}) => {

  const buttonStyle = {
    save: "transition-all transform duration-300 text-white px-4 mx-1 py-2 rounded border border-blue-500 hover:bg-slate-800 hover:scale-105",
    cancel: "transition-all transform duration-300 text-white px-4 mx-1 py-2 rounded border border-red-500 hover:bg-red-900 hover:bg-opacity-20 hover:scale-105",
  };

    return (
    <button
    className={`${buttonStyle[type]}`}
    onClick={handleSubmit}
    disabled={disabled}
  >
    {text}
  </button>

  )
}

export default GenericButton