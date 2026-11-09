import { setLanguage } from "@/app/actions";
import { LANGS, getLang } from "@/lib/i18n";

export async function LangSwitch() {
  const current = await getLang();
  return (
    <div className="inline-flex rounded-lg border border-line bg-surface p-0.5">
      {(Object.keys(LANGS) as (keyof typeof LANGS)[]).map((code) => (
        <form key={code} action={setLanguage}>
          <input type="hidden" name="lang" value={code} />
          <button
            aria-pressed={current === code}
            className={`inline-flex h-8 cursor-pointer items-center rounded-md px-3 text-sm transition ${
              current === code ? "bg-soft font-medium text-fg" : "text-muted hover:text-fg"
            }`}
          >
            {LANGS[code]}
          </button>
        </form>
      ))}
    </div>
  );
}
