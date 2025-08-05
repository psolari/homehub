import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ToastContainer } from 'react-toastify';
import { useSelector } from 'react-redux';

import HomePage from './pages/HomePage';
import LoginPage from './pages/LoginPage';
import DeviceTest from './DeviceTest';
import { selectAccessToken } from './redux/slices/AuthSlice';
import NavBar from './components/NavBar';
import SideBar from './components/SideBar';
import LogoutPage from './pages/LogoutPage';
import FloatingAddButton from './components/FloatingAddButton';

export default function App() {
  const accessToken = useSelector(selectAccessToken)
  const isAuthenticated = !!accessToken

  return (
    <div className="bg-gradient-to-br from-zinc-900 via-zinc-800 to-zinc-900 h-screen">
      <BrowserRouter>
        <ToastContainer
          position="bottom-right"
          autoClose={3000}
          hideProgressBar={false}
          closeOnClick
        />
          {!isAuthenticated ? (
            <Routes>
              <Route path="/" element={<LoginPage />} />
              <Route path="/logout" element={<LogoutPage />} />
              <Route path="*" element={<LoginPage />} />
            </Routes>
          ) : (
            <div className="flex">
              <FloatingAddButton />
              <SideBar />
              <NavBar />
              <div className="flex-1 ml-12 mt-12">
                <Routes>
                  <Route path="/" element={<HomePage />} />
                  <Route path="/device-test" element={<DeviceTest />} />
                  <Route path="/logout" element={<LogoutPage />} />
                  <Route path="*" element={<DeviceTest />} />
                </Routes>
              </div>
            </div>
          )}
      </BrowserRouter>
    </div>
  );
}

