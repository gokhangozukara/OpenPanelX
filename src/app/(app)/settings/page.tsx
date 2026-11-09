import QRCode from "qrcode";
import { ActionForm, Field, ThemeToggle } from "@/components/forms";
import { LangSwitch } from "@/components/lang-switch";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getT } from "@/lib/i18n";
import { open, otpauthUri } from "@/lib/totp";
import { cancelTotpSetup, changePassword, confirmTotp, disableTotp, startTotpSetup } from "../../actions";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const me = await requireUser();
  const { t } = await getT();

  // A secret that exists but is not confirmed yet means setup is in progress.
  const row = db.prepare("SELECT totp_secret FROM users WHERE id = ?").get(me.id) as { totp_secret: string | null };
  const pendingSecret = !me.totp_enabled && row.totp_secret ? open(row.totp_secret) : null;
  const qr = pendingSecret ? await QRCode.toString(otpauthUri(pendingSecret, me.username), { type: "svg", margin: 1 }) : null;

  return (
    <div className="grid max-w-2xl gap-8">
      <h1 className="text-2xl font-semibold tracking-tight">{t("settings")}</h1>

      <section className="card grid gap-5 p-5 sm:p-6">
        <div>
          <p className="label">{t("language")}</p>
          <LangSwitch />
        </div>
        <div>
          <p className="label">{t("theme")}</p>
          <ThemeToggle labels={{ light: t("light"), dark: t("dark"), system: t("system") }} />
        </div>
      </section>

      <section className="card p-5 sm:p-6">
        <div className="mb-1 flex items-center justify-between gap-3">
          <h2 className="text-sm font-medium">{t("twoFactor")}</h2>
          <span className={`rounded-md px-2 py-0.5 text-xs ${me.totp_enabled ? "bg-soft text-ok" : "bg-soft text-muted"}`}>
            {me.totp_enabled ? t("on") : t("twoFactorOff")}
          </span>
        </div>
        <p className="mb-5 text-sm text-muted">{t("twoFactorHint")}</p>

        {me.totp_enabled ? (
          <ActionForm action={disableTotp} submit={t("disable")} className="grid max-w-sm gap-4">
            <p className="text-sm text-muted">{t("disableHint")}</p>
            <Field name="password" label={t("password")} type="password" autoComplete="current-password" />
          </ActionForm>
        ) : pendingSecret && qr ? (
          // Once the one-time recovery codes are on screen, the QR code and key are no longer needed.
          <div className="group/setup grid gap-5">
            <p className="text-sm group-has-[[data-codes]]/setup:hidden">{t("scanQr")}</p>
            {/* Generated here from our own data. White background so scanners work in dark mode too. */}
            <div className="w-44 rounded-lg bg-white p-2 group-has-[[data-codes]]/setup:hidden [&_svg]:h-auto [&_svg]:w-full" dangerouslySetInnerHTML={{ __html: qr }} />
            <div className="group-has-[[data-codes]]/setup:hidden">
              <p className="text-sm text-muted">{t("orEnterKey")}</p>
              <p className="mt-1 font-mono text-sm tracking-wider break-all select-all">{pendingSecret.match(/.{1,4}/g)?.join(" ")}</p>
            </div>
            <ActionForm
              action={confirmTotp}
              submit={t("confirm")}
              className="grid max-w-sm gap-4"
              codes={{ title: t("recoveryTitle"), hint: t("recoveryHint"), done: t("done") }}
            >
              <div>
                <label className="label" htmlFor="code">
                  {t("enterCode")}
                </label>
                <input className="input font-mono tracking-widest" id="code" name="code" inputMode="numeric" autoComplete="one-time-code" required maxLength={8} />
              </div>
            </ActionForm>
            <form action={cancelTotpSetup} className="group-has-[[data-codes]]/setup:hidden">
              <button className="btn-ghost">{t("cancel")}</button>
            </form>
          </div>
        ) : (
          <form action={startTotpSetup}>
            <button className="btn-ghost">{t("setUp")}</button>
          </form>
        )}
      </section>

      <section className="card p-5 sm:p-6">
        <h2 className="mb-4 text-sm font-medium">{t("changePassword")}</h2>
        <ActionForm action={changePassword} submit={t("save")} resetOnOk className="grid max-w-sm gap-4">
          <Field name="current" label={t("currentPassword")} type="password" autoComplete="current-password" />
          <Field name="next" label={t("newPassword")} type="password" autoComplete="new-password" minLength={8} />
        </ActionForm>
      </section>
    </div>
  );
}
