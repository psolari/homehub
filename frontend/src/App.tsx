import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ToastContainer } from 'react-toastify';
import { useSelector } from 'react-redux';

import LoginPage from './pages/LoginPage';
import DeviceTest from './DeviceTest';
import { selectAccessToken } from './redux/slices/AuthSlice';

export default function App() {
  const accessToken = useSelector(selectAccessToken)
  const isAuthenticated = !!accessToken

  return (
    <div className="bg-zinc-800 min-h-screen w-screen">
      <BrowserRouter>
        <ToastContainer
          position="bottom-right"
          autoClose={3000}
          hideProgressBar={false}
          closeOnClick
        />
        <div className="flex">
          {!isAuthenticated ? (
            <Routes>
              <Route path="/" element={<LoginPage />} />
              <Route path="*" element={<LoginPage />} />
            </Routes>
          ) : (
            <Routes>
              <Route path="/" element={<DeviceTest />} />
              <Route path="*" element={<DeviceTest />} />
            </Routes>
          )}
        </div>
      </BrowserRouter>
    </div>
  );
}

