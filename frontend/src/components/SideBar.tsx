import { mdiCog, mdiFloorPlan, mdiRemoteTv, mdiLogout } from '@mdi/js';
import Icon from '@mdi/react';

const menuItems = [
  { icon: mdiFloorPlan, name: 'Floor Plan', link: '/floor-plan' },
  { icon: mdiRemoteTv, name: 'TV Controls', link: '/tv-controls' },
  { icon: mdiCog, name: 'Settings', link: '/settings' },
];

const SideBar = () => {
  const handleLogout = () => {
    window.location.href = '/logout';
  };

  return (
    <div>
      <div
        className={`fixed top-0 left-0 h-full bg-neutral-900 text-white transition-width duration-300 z-40 w-12`}
      >
        <ul className="menu list-none pt-12">
          {menuItems.map((item, index) => (
            <li key={index} className="menu-item p-2 pl-3 hover:bg-sky-900 h-10">
              <a href={item.link} className="text-white no-underline flex items-center text-nowrap">
                <Icon className='flex-shrink-0' path={item.icon} size={0.8} />
              </a>
            </li>
          ))}
        </ul>
        <div className="absolute bottom-0 w-full p-2 pl-3 hover:bg-red-700 h-10">
          <button
            onClick={handleLogout}
            className="menu-button flex items-center w-full text-left text-white no-underline cursor-pointer"
            type="button"
          >
            <Icon className="flex-shrink-0" path={mdiLogout} size={0.8} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default SideBar;
