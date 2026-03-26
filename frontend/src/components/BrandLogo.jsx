import { Link } from "react-router-dom";
import { BRAND_LOGO_PATH, BRAND_NAME } from "../utils/branding.js";

const SIZE_STYLES = {
  sm: {
    image: "h-8 sm:h-9",
    text: "text-lg sm:text-xl",
  },
  md: {
    image: "h-9 sm:h-10",
    text: "text-xl sm:text-2xl",
  },
};

export default function BrandLogo({
  to = "/",
  size = "md",
  className = "",
  textClassName = "text-slate-900",
}) {
  const styles = SIZE_STYLES[size] || SIZE_STYLES.md;

  return (
    <Link
      to={to}
      aria-label={`Go to ${BRAND_NAME}`}
      className={`group inline-flex min-w-0 items-center gap-3 rounded-2xl px-1 py-1 transition duration-200 ease-out hover:-translate-y-0.5 hover:opacity-95 focus:outline-none focus:ring-2 focus:ring-sky-400 focus:ring-offset-2 ${className}`}
    >
      <img
        src={BRAND_LOGO_PATH}
        alt={`${BRAND_NAME} logo`}
        className={`${styles.image} w-auto shrink-0 object-contain transition duration-200 ease-out group-hover:scale-[1.02]`}
      />
      <span className={`${styles.text} truncate font-semibold tracking-tight ${textClassName}`}>
        {BRAND_NAME}
      </span>
    </Link>
  );
}
