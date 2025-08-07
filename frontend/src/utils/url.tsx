/// function to retrieve the base URL of the application
export function getBackendUrls() {
  const baseUrl = import.meta.env.VITE_BACKEND_URL || "http://localhost:8000";
  const apiUrl = `${baseUrl}/api`;
  return {
    baseUrl,
    apiUrl,
  };
}
