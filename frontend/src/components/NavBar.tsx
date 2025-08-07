import { mdiHomeAutomation } from "@mdi/js";
import Icon from "@mdi/react";
import { useNavigate } from "react-router-dom";

const NavBar = () => {
  const navigate = useNavigate();

  const navHome = () => {
    navigate("/");
  };

  return (
    <div className="bg-neutral-900 text-white fixed top-0 left-0 right-0 z-50 p-2">
      <nav>
        <div className="flex justify-between items-center">
          <button
            onClick={navHome}
            className="menu-button flex items-center text-white no-underline cursor-pointer ml-0.5"
            type="button"
          >
            <Icon className="flex-shrink-0" path={mdiHomeAutomation} size={1} />
          </button>
          <div className="text-2xl">
            <h2>HomeHub</h2>
          </div>
          <div></div>
        </div>
      </nav>
    </div>
  );
};

export default NavBar;
