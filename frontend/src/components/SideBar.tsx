import {
  mdiCog,
  mdiFloorPlan,
  mdiRemoteTv,
  mdiLogout,
  mdiDevices,
} from "@mdi/js";
import Icon from "@mdi/react";
import { Link, useNavigate } from "react-router-dom";

const menuItems = [
  { icon: mdiDevices, name: "Devices", link: "/devices" },
  { icon: mdiFloorPlan, name: "Floor Plan", link: "/floorplans" },
  { icon: mdiRemoteTv, name: "TV Controls", link: "/tv-controls" },
  { icon: mdiCog, name: "Settings", link: "/settings" },
];

const SideBar = () => {
  const navigate = useNavigate();

  const handleLogout = () => {
    navigate("/logout");
  };

  return (
    <div>
      <div
        className={`fixed top-0 left-0 h-full bg-neutral-900 text-white transition-width duration-300 z-40 w-12`}
      >
        <ul className="menu list-none pt-12">
          {menuItems.map((item, index) => (
            <li key={index} className="menu-item h-10">
              <Link
                to={item.link}
                className="flex items-center w-full h-full p-2 pl-3 text-white no-underline hover:bg-sky-900"
              >
                <Icon
                  className="flex-shrink-0 ml-0.5"
                  path={item.icon}
                  size={0.8}
                />
              </Link>
            </li>
          ))}
        </ul>
        <div className="absolute bottom-0 w-full h-10">
          <button
            onClick={handleLogout}
            className="flex items-center w-full h-full p-2 pl-3 text-white no-underline hover:bg-red-700 cursor-pointer"
            type="button"
          >
            <Icon
              className="flex-shrink-0 ml-0.5 mt-1"
              path={mdiLogout}
              size={0.8}
            />
          </button>
        </div>
      </div>
    </div>
  );
};

export default SideBar;
