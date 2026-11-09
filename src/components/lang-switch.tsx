import { setLanguage } from "@/app/actions";
import { LANGS, getLang } from "@/lib/i18n";

/** `compact` shows short codes (EN, TR, DE) for tight places like the sidebar. */
export async function LangSwitch({ compact = false }: { compact?: boolean }) {
  const current = await getLang();
  return (
    <div className="inline-flex rounded-lg border border-line bg-surface p-0.5">
      {(Object.keys(LANGS) as (keyof typeof LANGS)[]).map((code) => (
        <form key={code} action={setLanguage}>
          <input type="hidden" name="lang" value={code} />
          <button
            aria-pressed={current === code}
            aria-label={LANGS[code]}
            title={LANGS[code]}
            className={`inline-flex cursor-pointer items-center rounded-md text-sm transition ${compact ? "h-7 px-2 text-xs" : "h-8 px-3"} ${
              current === code ? "bg-soft font-medium text-fg" : "text-muted hover:text-fg"
            }`}
          >
            {compact ? code.toUpperCase() : LANGS[code]}
          </button>
        </form>
      ))}
    </div>
  );
}
