// src/api/ApiService.ts
import { getBackendUrls } from "../utils/url";
import { ApiError } from "./ApiError";

export class ApiService {
  static async request(
    method: string,
    endpoint: string,
    body: object | null = null,
    headers: Record<string, string> = {},
  ) {
    const { apiUrl } = getBackendUrls();
    const fullUrl = apiUrl + endpoint;

    const finalHeaders = {
      "Content-Type": "application/json",
      ...headers,
    };

    const config: RequestInit = {
      method,
      headers: finalHeaders,
    };

    if (body) {
      config.body = JSON.stringify(body);
    }

    const response = await fetch(fullUrl, config);

    if (!response.ok) {
      const errorData = await response.json();
      throw new ApiError(errorData.error || "API error", errorData);
    }

    if (response.status === 204) return true;

    return response.json();
  }
}
