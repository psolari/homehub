import React from "react";

interface GenericModalProps {
  children: React.ReactNode;
  isOpen: boolean;
  onClose: () => void;
  width?: string;
  height?: string;
}

const GenericModal: React.FC<GenericModalProps> = ({
  children,
  isOpen,
  onClose,
  width,
  height,
}) => {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 z-50"
      onClick={onClose}
    >
      <div
        className={`bg-gradient-to-br from-zinc-800 to-zinc-900 border border-zinc-600 rounded-lg p-4 ${width ? width : "w-auto"} ${height ? height : "h-auto"} overflow-y-auto`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
};

export default GenericModal;
