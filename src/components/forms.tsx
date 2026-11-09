"use client";

import { Sun, Moon } from "lucide-react";
import { useActionState, useEffect, useState } from "react";
import type { FormState } from "@/app/actions";

/** A form that shows the server's error or success message under the fields. */
export function ActionForm({
  action,
  submit,
  children,
  className = "grid gap-4",
  resetOnOk = false,
  codes,
}: {
  action: (s: FormState, f: FormData) => Promise<FormState>;
  submit: string;
  children: React.ReactNode;
  className?: string;
  resetOnOk?: boolean;
  /** Text for showing one-time recovery codes the server hands back. */
  codes?: { title: string; hint: string; done: string };
}) {
  const [state, run, pending] = useActionState(action, undefined);

  if (codes && state?.codes) {
    return (
      <div className="grid gap-4" data-codes>
        <div>
          <h3 className="text-sm font-medium">{codes.title}</h3>
          <p className="mt-1 text-sm text-muted">{codes.hint}</p>
        </div>
        <ul className="grid grid-cols-2 gap-2 rounded-lg border border-line bg-soft p-4 font-mono text-sm">
          {state.codes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        {/* A full page load, so the settings page shows the new "on" state. */}
        <a className="btn" href="/settings">
          {codes.done}
        </a>
      </div>
    );
  }

  return (
    <form
      action={run}
      className={className}
      ref={(el) => {
        if (el && resetOnOk && state?.ok) el.reset();
      }}
    >
      {children}
      <div aria-live="polite" className="text-sm empty:hidden">
        {state?.error && <p className="text-danger">{state.error}</p>}
        {state?.ok && <p className="text-ok">{state.ok}</p>}
      </div>
      <button className="btn" disabled={pending}>
        {submit}
      </button>
    </form>
  );
}

export function Field({
  name,
  label,
  type = "text",
  autoComplete,
  minLength,
  required = true,
}: {
  name: string;
  label: string;
  type?: string;
  autoComplete?: string;
  minLength?: number;
  required?: boolean;
}) {
  return (
    <div>
      <label className="label" htmlFor={name}>
        {label}
      </label>
      <input className="input" id={name} name={name} type={type} autoComplete={autoComplete} minLength={minLength} required={required} />
    </div>
  );
}

type Theme = "light" | "dark";

/** Light is the default. Dark is only used when the person picks it. */
export function ThemeToggle({ labels }: { labels: Record<Theme, string> }) {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    try {
      const saved = localStorage.getItem("oha_theme");
      if (saved === "light" || saved === "dark") setTheme(saved);
    } catch {}
  }, []);

  const apply = (next: Theme) => {
    setTheme(next);
    try {
      localStorage.setItem("oha_theme", next);
    } catch {}
    document.documentElement.setAttribute("data-theme", next);
  };

  const opts: { v: Theme; icon: typeof Sun }[] = [
    { v: "light", icon: Sun },
    { v: "dark", icon: Moon },
  ];
  return (
    <div className="inline-flex rounded-lg border border-line bg-surface p-0.5" role="radiogroup">
      {opts.map(({ v, icon: Icon }) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={theme === v}
          onClick={() => apply(v)}
          className={`inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md px-3 text-sm transition ${
            theme === v ? "bg-soft font-medium text-fg" : "text-muted hover:text-fg"
          }`}
        >
          <Icon className="size-3.5" aria-hidden />
          {labels[v]}
        </button>
      ))}
    </div>
  );
}
