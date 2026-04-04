const DEFAULT_API_BASE_URL = "https://antigravitygig-2.onrender.com";
const LOCALHOST_API_PATTERN = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i;

function normalizeBaseUrl(url) {
  return (url || DEFAULT_API_BASE_URL).trim().replace(/\/+$/, "");
}

function getUrlOrigin(url) {
  try {
    return new URL(normalizeBaseUrl(url)).origin;
  } catch {
    return normalizeBaseUrl(url);
  }
}

export const API_BASE_URL = normalizeBaseUrl(
  import.meta.env.VITE_API_BASE_URL
);

export const SOCKET_BASE_URL = normalizeBaseUrl(
  import.meta.env.VITE_SOCKET_URL || API_BASE_URL
);

export function buildApiUrl(path) {
  if (!path) return API_BASE_URL;
  return `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

export function isLocalApiBaseUrl(url = API_BASE_URL) {
  return LOCALHOST_API_PATTERN.test(getUrlOrigin(url));
}

export function getApiConnectionHelp() {
  if (isLocalApiBaseUrl()) {
    return `Start the backend on ${API_BASE_URL} or update VITE_API_BASE_URL to ${DEFAULT_API_BASE_URL}.`;
  }

  return `Check that the backend is reachable at ${API_BASE_URL}.`;
}

export function getGoogleAuthRedirectMismatchMessage(authUrl) {
  try {
    const redirectUri = new URL(authUrl).searchParams.get("redirect_uri");

    if (!redirectUri) {
      return "Google OAuth is misconfigured: the backend did not provide a callback URL.";
    }

    if (isLocalApiBaseUrl(redirectUri) && !isLocalApiBaseUrl()) {
      return `Google OAuth is pointing to ${redirectUri}, but this app is configured to use ${API_BASE_URL}. Restart the frontend if it is stale, or fix the backend Google redirect settings.`;
    }
  } catch {
    return "Google OAuth returned an invalid authorization URL.";
  }

  return "";
}
