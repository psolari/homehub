import { getBackendUrls } from '../utils/url';

class ApiService {
  static async request(
    method: string = "GET",
    endpoint: string,
    body: object | null = null,
    headers: Record<string, string> = {}  // This is just a type, not a value
  ) {
    const username = 'admin';
    const password = 'admin';
    const basicAuth = 'Basic ' + btoa(username + ':' + password);
    const defaultHeaders = {
      "Authorization": basicAuth,
      "Content-Type": "application/json",
    };
    const { apiUrl } = getBackendUrls();
    const fullUrl = apiUrl + endpoint;

    const finalHeaders = { ...defaultHeaders, ...headers };
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
      throw new Error(errorData.error || "API error");
    }

    if (response.status === 204) return true; // no content

    return response.json();
  }
}

export default ApiService;