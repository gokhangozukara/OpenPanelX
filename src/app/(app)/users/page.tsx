import { ActionForm, Field } from "@/components/forms";
import { requireUser } from "@/lib/auth";
import { db, type UserRow } from "@/lib/db";
import { getT } from "@/lib/i18n";
import { addUser, deleteUser, resetUserTotp } from "../../actions";

export const metadata = { title: "Users" };

export default async function UsersPage() {
  const me = await requireUser("admin");
  const { t } = await getT();
  const users = db.prepare("SELECT id, username, role, created_at, totp_enabled FROM users ORDER BY id").all() as UserRow[];

  return (
    <div className="grid gap-8">
      <h1 className="text-2xl font-semibold tracking-tight">{t("users")}</h1>

      <section className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-line text-xs text-muted">
                <th className="px-5 py-2.5 font-medium">{t("username")}</th>
                <th className="px-5 py-2.5 font-medium">{t("role")}</th>
                <th className="px-5 py-2.5 font-medium">{t("created")}</th>
                <th className="px-5 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-line last:border-0">
                  <td className="px-5 py-3 font-medium">
                    {u.username}
                    {u.id === me.id && <span className="ml-2 text-xs font-normal text-muted">({t("you")})</span>}
                  </td>
                  <td className="px-5 py-3">
                    <span className="rounded-md bg-soft px-2 py-0.5 text-xs">{t(u.role)}</span>
                    {u.totp_enabled ? <span className="ml-1.5 rounded-md bg-soft px-2 py-0.5 text-xs text-ok">2FA</span> : null}
                  </td>
                  <td className="px-5 py-3 text-muted tabular-nums">{u.created_at.slice(0, 10)}</td>
                  <td className="px-5 py-3">
                    {u.id !== me.id && (
                      <div className="flex justify-end gap-4">
                        {u.totp_enabled ? (
                          <form action={resetUserTotp}>
                            <input type="hidden" name="id" value={u.id} />
                            <button className="cursor-pointer text-sm text-muted hover:text-fg hover:underline">{t("reset2fa")}</button>
                          </form>
                        ) : null}
                        <form action={deleteUser}>
                          <input type="hidden" name="id" value={u.id} />
                          <button className="cursor-pointer text-sm text-danger hover:underline">{t("delete")}</button>
                        </form>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card p-5 sm:p-6">
        <h2 className="mb-4 text-sm font-medium">{t("addUser")}</h2>
        <ActionForm action={addUser} submit={t("addUser")} resetOnOk className="grid max-w-md gap-4">
          <Field name="username" label={t("username")} autoComplete="off" minLength={3} />
          <Field name="password" label={t("password")} type="password" autoComplete="new-password" minLength={8} />
          <div>
            <label className="label" htmlFor="role">
              {t("role")}
            </label>
            <select className="input" id="role" name="role" defaultValue="viewer">
              <option value="viewer">{t("viewer")}</option>
              <option value="editor">{t("editor")}</option>
              <option value="admin">{t("admin")}</option>
            </select>
          </div>
        </ActionForm>
      </section>
    </div>
  );
}
