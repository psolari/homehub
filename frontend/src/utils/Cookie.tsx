const setCookie = (
  name: string,
  value: string,
  expiresInSeconds: number
) => {
  const expires = new Date(expiresInSeconds * 1000).toUTCString();
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax; Secure`;
};

const getCookie = (name: string) => {
  const cookies = document.cookie.split("; ");
  for (const c of cookies) {
    const [key, value] = c.split("=");
    if (key === name) return decodeURIComponent(value);
  }
  return null;
};

const deleteCookie = (name: string) => {
  setCookie(name, "", -1);
};

export { setCookie, getCookie, deleteCookie };
