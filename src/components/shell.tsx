"use client";

import { LogOut, Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { NavIcon } from "./icons";
import { Logo } from "./logo";

export type NavItem = { href: string; label: string; icon: string };

export function Shell({
  nav,
  plugins,
  pluginsLabel,
  username,
  roleLabel,
  signOutLabel,
  signOutAction,
  openMenu,
  closeMenu,
  quick,
  children,
}: {
  /** Language and theme quick controls, rendered on the server and shown above the user card. */
  quick?: React.ReactNode;
  nav: NavItem[];
  plugins: NavItem[];
  pluginsLabel: string;
  username: string;
  roleLabel: string;
  signOutLabel: string;
  signOutAction: () => Promise<void>;
  openMenu: string;
  closeMenu: string;
  children: React.ReactNode;
}) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const active = (href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(href + "/"));

  const link = (item: NavItem) => (
    <Link
      key={item.href}
      href={item.href}
      onClick={() => setOpen(false)}
      aria-current={active(item.href) ? "page" : undefined}
      className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition ${
        active(item.href) ? "bg-soft font-medium text-fg" : "text-muted hover:bg-soft hover:text-fg"
      }`}
    >
      <NavIcon name={item.icon} className="size-4 shrink-0" />
      <span className="truncate">{item.label}</span>
    </Link>
  );

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[15rem_1fr]">
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-line bg-bg/90 px-4 backdrop-blur lg:hidden">
        <Logo />
        <button className="btn-ghost size-9 !p-0" aria-label={open ? closeMenu : openMenu} onClick={() => setOpen(!open)}>
          {open ? <X className="size-4" /> : <Menu className="size-4" />}
        </button>
      </header>

      <aside
        className={`${open ? "flex" : "hidden"} fixed inset-x-0 top-14 bottom-0 z-20 flex-col gap-6 overflow-y-auto border-r border-line bg-bg p-4 lg:sticky lg:top-0 lg:flex lg:h-dvh lg:w-60`}
      >
        <div className="hidden lg:block">
          <Logo />
        </div>
        <nav className="flex flex-col gap-0.5">{nav.map(link)}</nav>
        {plugins.length > 0 && (
          <nav className="flex flex-col gap-0.5">
            <p className="px-2.5 pb-1 text-xs font-medium tracking-wide text-muted uppercase">{pluginsLabel}</p>
            {plugins.map(link)}
          </nav>
        )}
        {quick && <div className="mt-auto flex items-center justify-between gap-2">{quick}</div>}
        <div className={`${quick ? "" : "mt-auto "}flex items-center gap-2.5 rounded-lg border border-line bg-surface p-2.5`}>
          <div className="grid size-8 shrink-0 place-items-center rounded-full bg-soft text-xs font-semibold uppercase">
            {username.slice(0, 2)}
          </div>
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate text-sm font-medium">{username}</p>
            <p className="truncate text-xs text-muted">{roleLabel}</p>
          </div>
          <form action={signOutAction}>
            <button className="grid size-8 cursor-pointer place-items-center rounded-md text-muted transition hover:bg-soft hover:text-fg" aria-label={signOutLabel} title={signOutLabel}>
              <LogOut className="size-4" />
            </button>
          </form>
        </div>
      </aside>

      <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-8 lg:py-10">{children}</main>
    </div>
  );
}
