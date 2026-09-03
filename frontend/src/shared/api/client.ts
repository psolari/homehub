const API_BASE = `${import.meta.env.VITE_BACKEND_URL || "http://localhost:8000"}/api/v1`;

export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  if (!response.ok) {
    const text = await response.text();
    let message = text || `Request failed (${response.status})`;
    try {
      const parsed = JSON.parse(text);
      message = parsed.error || parsed.detail || message;
    } catch {
      message = text || message;
    }
    throw new Error(message);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const get = <T>(path: string) => request<T>(path);
export const post = <T>(path: string, data?: unknown) => request<T>(path, { method: "POST", body: JSON.stringify(data ?? {}) });
export const patch = <T>(path: string, data: unknown) => request<T>(path, { method: "PATCH", body: JSON.stringify(data) });
export const remove = <T>(path: string) => request<T>(path, { method: "DELETE" });
export const apiUrl = (path: string) => `${API_BASE}${path}`;
