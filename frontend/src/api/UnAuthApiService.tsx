import { getBackendUrls } from "../utils/url";
import { ApiError } from "./ApiError";

class UnAuthApiService {
  async request(
    method: string = "GET",
    endpoint: string,
    body: object | null = null,
    headers: Record<string, string> = {}
  ) {
    const { apiUrl } = getBackendUrls();

    const defaultHeaders = {
      "Content-Type": "application/json",
    };

    const finalHeaders = { ...defaultHeaders, ...headers };

    const headerConfig = {
      method: method,
      headers: finalHeaders,
      body: null as string | null,
    };

    if (body) {
      headerConfig.body = JSON.stringify(body);
    }

    try {
      return fetch(apiUrl + endpoint, headerConfig)
        .then((response) => {
          if (!response.ok) {
            throw new ApiError(
              `Could not fetch the data for that resource: ${response.body}`,
            );
          }

          if (response.status === 204) {
            return true;
          }

          return response.json();
        })
        .then((data) => {
          if (data) {
            return data;
          }
        })
        .catch((error) => {
          console.error("API request failed:", error);
          throw error;
        });
    } catch (error) {
      console.error("API request failed:", error);
      throw error;
    }
  }
}

export default new UnAuthApiService();
