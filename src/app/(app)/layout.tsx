import { ThemeButton } from "@/components/forms";
import { LangSwitch } from "@/components/lang-switch";
import { Shell, type NavItem } from "@/components/shell";
import { hasRole, requireUser } from "@/lib/auth";
import { getT, pick } from "@/lib/i18n";
import { listPlugins } from "@/lib/plugins";
import { signOut } from "../actions";

export const dynamic = "force-dynamic"; // plugins are read from disk on every request

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const { t, lang } = await getT();

  const nav: NavItem[] = [
    { href: "/", label: t("dashboard"), icon: "dashboard" },
    ...(hasRole(user, "admin") ? [{ href: "/users", label: t("users"), icon: "users" }] : []),
    { href: "/settings", label: t("settings"), icon: "settings" },
  ];
  const plugins: NavItem[] = listPlugins()
    .filter((p) => hasRole(user, p.minRole))
    .map((p) => ({ href: `/plugins/${p.id}`, label: pick(p.name, lang), icon: p.icon }));

  return (
    <Shell
      nav={nav}
      plugins={plugins}
      pluginsLabel={t("plugins")}
      username={user.username}
      roleLabel={t(user.role)}
      signOutLabel={t("signOut")}
      signOutAction={signOut}
      openMenu={t("openMenu")}
      closeMenu={t("closeMenu")}
      quick={
        <>
          <LangSwitch compact />
          <ThemeButton lightLabel={t("light")} darkLabel={t("dark")} />
        </>
      }
    >
      {children}
    </Shell>
  );
}
