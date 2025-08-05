import { useState, useRef, useEffect } from "react";
import type { ReactNode } from "react";

const ToolTip = ({
  text = "",
  position = "top",
  delay = 1000,
  size = "medium",
  children,
}: {
  text?: string;
  position?: "top" | "right" | "bottom" | "left";
  delay?: number;
  size?: "small" | "medium" | "large";
  children?: ReactNode;
}) => {
  const [visible, setVisible] = useState(false);
  const timeoutRef = useRef(0);

  const showTooltip = () => {
    if (text) {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      timeoutRef.current = setTimeout(() => {
        setVisible(true);
      }, delay);
    }
  };

  const hideTooltip = () => {
    clearTimeout(timeoutRef.current);
    setVisible(false);
  };

  useEffect(() => {
    return () => {
      clearTimeout(timeoutRef.current);
    };
  }, []);

  const getPositionClasses = () => {
    switch (position) {
      case "top":
        return "bottom-full left-1/2 transform -translate-x-1/2 -translate-y-1 mb-2";
      case "right":
        return "left-full top-1/2 transform -translate-y-1/2 ml-2";
      case "bottom":
        return "top-full left-1/2 transform -translate-x-1/2 mt-2";
      case "left":
        return "right-full top-1/2 transform -translate-y-1/2 mr-2";
      default:
        return "top-full left-1/2 transform -translate-x-1/2 mt-2";
    }
  };

  const getSizeClasses = () => {
    switch (size) {
      case "small":
        return "w-24 h-auto p-1 text-xs";
      case "medium":
        return "w-32 h-auto p-2 text-sm";
      case "large":
        return "w-48 h-auto p-3 text-sm";
      default:
        return "w-32 h-auto p-2 text-sm";
    }
  };

  const getArrowClasses = () => {
    switch (position) {
      case "top":
        return "absolute left-1/2 transform -translate-x-1/2 top-full border-t-zinc-700";
      case "right":
        return "absolute top-1/2 transform -translate-y-1/2 left-0 border-r-zinc-700";
      case "bottom":
        return "absolute left-1/2 transform -translate-x-1/2 bottom-full border-b-zinc-700";
      case "left":
        return "absolute top-1/2 transform -translate-y-1/2 right-0 border-l-zinc-700";
      default:
        return "";
    }
  };

  return (
    <div className="relative inline-block">
      <div
        className="cursor-pointer"
        onMouseEnter={showTooltip}
        onMouseLeave={hideTooltip}
      >
        {children}
      </div>
      {visible && text && (
        <div
          className={`absolute z-50 text-gray-100 bg-zinc-700 rounded shadow-lg whitespace-normal break-words ${getPositionClasses()} ${getSizeClasses()}`}
          style={{ maxWidth: "200px" }}
        >
          {text}
          <div
            className={`w-0 h-0 border-solid border-transparent ${getArrowClasses()}`}
            style={{
              borderWidth: "6px",
            }}
          />
        </div>
      )}
    </div>
  );
};

export default ToolTip;
