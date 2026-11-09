export function Logo({ size = "md" }: { size?: "md" | "lg" }) {
  const box = size === "lg" ? "size-11 rounded-xl" : "size-8 rounded-lg";
  return (
    <div className="flex items-center gap-2.5">
      <span className={`${box} grid place-items-center bg-accent text-accent-fg`}>
        <svg viewBox="0 0 24 24" className={size === "lg" ? "size-6" : "size-4"} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
          <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
          <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
          <path d="M17 13.5v7M13.5 17h7" />
        </svg>
      </span>
      <span className={size === "lg" ? "text-xl font-semibold tracking-tight" : "text-[15px] font-semibold tracking-tight"}>OpenHubAdmin</span>
    </div>
  );
}
