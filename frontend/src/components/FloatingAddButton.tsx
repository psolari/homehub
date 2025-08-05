import { useState, useEffect, useRef } from 'react';
import Icon from '@mdi/react';
import { mdiPlus, mdiDevices, mdiFloorPlan, mdiBed } from '@mdi/js';

import ToolTip from './ToolTip';

const FloatingAddButton = () => {
  const [isOpen, setIsOpen] = useState(false);
  const buttonRef = useRef<HTMLDivElement>(null);

  const handleClickOutside = (event: MouseEvent) => {
    if (buttonRef.current && !buttonRef.current.contains(event.target as Node)) {
      setIsOpen(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('click', handleClickOutside);
    } else {
      document.removeEventListener('click', handleClickOutside);
    }
    return () => {
      document.removeEventListener('click', handleClickOutside);
    };
  }, [isOpen]);

  return (
    <div ref={buttonRef} className="fixed bottom-4 right-4 z-50">
      <div className="absolute bottom-14 right-14">
          <button
            onClick={() => console.log('Devices')}
            className={`absolute w-12 h-12 bg-blue-500 text-white rounded-full shadow-lg flex items-center justify-center transition-transform duration-300 transform hover:scale-110 ${
              isOpen
                ? "translate-x-0 translate-y-[-70px]"
                : "translate-x-0 translate-y-0"
            }`}
          >
            <ToolTip text="Add Devices" delay={0} size={"small"}>
              <Icon path={mdiDevices} size={1}/>
            </ToolTip>
          </button>
          <button
            onClick={() => console.log('Floor Plan')}
            className={`absolute w-12 h-12 bg-green-500 text-white rounded-full shadow-lg flex items-center justify-center transition-transform duration-300 transform hover:scale-110 ${
              isOpen
                ? "translate-x-[-55px] translate-y-[-55px]"
                : "translate-x-0 translate-y-0"
            }`}
          >
            <ToolTip text="Add Floor Plan" delay={0} size={"small"}>
              <Icon path={mdiFloorPlan} size={1} />
            </ToolTip>
          </button>
          <button
            onClick={() => console.log('Room')}
            className={`absolute w-12 h-12 bg-red-500 text-white rounded-full shadow-lg flex items-center justify-center transition-transform duration-300 transform hover:scale-110 ${
              isOpen
                ? "translate-x-[-70px] translate-y-0"
                : "translate-x-0 translate-y-0"
            }`}
          >
            <ToolTip text="Add Room" delay={0} size={"small"}>
              <Icon path={mdiBed} size={1} />
            </ToolTip>
          </button>
      </div>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-16 h-16 text-white rounded-full shadow-xl flex items-center justify-center bg-sky-400 transition-transform duration-300 transform hover:scale-110"
      >
        <Icon path={mdiPlus} size={1} />
      </button>
    </div>
  );
};

export default FloatingAddButton;
