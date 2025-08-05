const decodePayload = (token: string) => {
  try {
    const [, payload] = token.split(".");
    const decodedPayload = JSON.parse(atob(payload));
    return decodedPayload;
  } catch (error) {
    console.error("Error decoding token payload:", error);
    return null;
  }
};

const isTokenExpired = (token: string) => {
  if (!token) return true;
  const decoded = decodePayload(token);
  const currentTime = Date.now() / 1000;
  return decoded.exp < currentTime;
};

export { decodePayload, isTokenExpired };
