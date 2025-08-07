import { useDispatch } from "react-redux";
import type { AppDispatch } from "../redux/store"; // adjust path

export const useAppDispatch = () => useDispatch<AppDispatch>();
