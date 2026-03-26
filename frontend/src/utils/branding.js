export const BRAND_NAME = "GigBridge";
export const BRAND_LOGO_PATH = "/assets/gigbridgelogo.png";

export function getBrandLogoUrl() {
  if (typeof window === "undefined") {
    return BRAND_LOGO_PATH;
  }

  return `${window.location.origin}${BRAND_LOGO_PATH}`;
}

export function getDashboardPath(user) {
  const role = String(user?.role || "").toLowerCase().trim();

  if (role === "freelancer" || role === "artist") {
    return "/artist/dashboard";
  }

  if (role === "client") {
    return "/my-projects";
  }

  if (role === "admin") {
    return "/admin/dashboard";
  }

  return "/";
}
