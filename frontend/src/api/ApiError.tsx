export class ApiError extends Error {
  responseData: unknown;

  constructor(message: string, responseData?: unknown) {
    super(message);
    this.name = "ApiError";
    this.responseData = responseData;
  }
}
