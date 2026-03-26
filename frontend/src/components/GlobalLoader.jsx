import { BRAND_LOGO_PATH, BRAND_NAME } from "../utils/branding.js";

export default function GlobalLoader({ message = "Loading GigBridge..." }) {
  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/10 backdrop-blur-sm">
      <div
        className="flex min-w-[280px] flex-col items-center gap-4 rounded-3xl bg-white px-8 py-8 shadow-2xl ring-1 ring-slate-200"
        role="status"
        aria-live="polite"
      >
        <img
          src={BRAND_LOGO_PATH}
          alt={`${BRAND_NAME} logo`}
          className="h-16 w-auto animate-pulse object-contain sm:h-20"
        />
        <div className="space-y-1 text-center">
          <p className="text-lg font-semibold text-slate-900">{BRAND_NAME}</p>
          <p className="text-sm text-slate-500">{message}</p>
        </div>
        <span className="sr-only">{message}</span>
      </div>
    </div>
  );
}
