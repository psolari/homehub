import { useNavigate } from "react-router-dom";
import { mdiHome, mdiWifi, mdiCog, mdiPower } from "@mdi/js";
import Icon from "@mdi/react";

export default function HomePage() {
  const navigate = useNavigate();

  const actions = [
    {
      icon: <Icon path={mdiWifi} size={1.5} />,
      label: "Devices",
      path: "/devices",
    },
    {
      icon: <Icon path={mdiCog} size={1.5} />,
      label: "Settings",
      path: "/settings",
    },
    {
      icon: <Icon path={mdiPower} size={1.5} />,
      label: "Shutdown",
      path: "/shutdown",
    },
  ];

  return (
    <div className="min-h-full w-full text-white">
      <nav className="flex items-center justify-between px-8 py-4 border-b border-zinc-700">
        <div className="flex items-center gap-2">
          <Icon path={mdiHome} size={1} />
          <h1 className="text-xl font-bold">HomeHub</h1>
        </div>
      </nav>

      <div className="flex flex-col items-center justify-center text-center py-20 px-4">
        <h1 className="text-4xl sm:text-5xl font-extrabold mb-4 tracking-tight">
          Welcome to HomeHub
        </h1>
        <p className="text-zinc-400 text-lg max-w-xl">
          Control and monitor your smart home from one beautiful, simple
          interface.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 max-w-4xl mx-auto px-6 pb-20">
        {actions.map((action, index) => (
          <button
            key={index}
            onClick={() => navigate(action.path)}
            className="bg-zinc-800 border border-zinc-700 hover:border-cyan-500 hover:shadow-xl hover:scale-105 transition-all rounded-xl p-6 text-center flex flex-col items-center gap-3"
          >
            {action.icon}
            <span className="text-lg font-medium">{action.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
