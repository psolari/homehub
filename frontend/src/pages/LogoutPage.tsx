import { useEffect } from "react";
import { useDispatch } from "react-redux";
import { logout } from "../redux/slices/AuthSlice";
import type { AppDispatch } from "../redux/store"; // Import the AppDispatch type

const LogoutPage = () => {
  const dispatch: AppDispatch = useDispatch(); // Explicitly type the dispatch function

  useEffect(() => {
    dispatch(logout());
  }, [dispatch]);

  return (
    <div className="flex items-center justify-center h-screen bg-zinc-800 text-white">
      <h1>Logging out...</h1>
    </div>
  );
};

export default LogoutPage;
