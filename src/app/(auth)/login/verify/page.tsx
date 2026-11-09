import Link from "next/link";
import { redirect } from "next/navigation";
import { ActionForm } from "@/components/forms";
import { getPending } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { verifyLogin } from "../../../actions";

export const metadata = { title: "Verify" };

export default async function VerifyPage() {
  if ((await getPending()) === null) redirect("/login");
  const { t } = await getT();
  return (
    <>
      <h1 className="text-lg font-semibold tracking-tight">{t("verifyTitle")}</h1>
      <p className="mt-1 mb-6 text-sm text-muted">{t("verifyHint")}</p>
      <ActionForm action={verifyLogin} submit={t("verify")}>
        <div>
          <label className="label" htmlFor="code">
            {t("codeLabel")}
          </label>
          <input
            className="input text-center font-mono text-lg tracking-widest"
            id="code"
            name="code"
            autoComplete="one-time-code"
            autoFocus
            required
            maxLength={16}
          />
        </div>
      </ActionForm>
      <Link href="/login" className="mt-4 block text-center text-sm text-muted hover:text-fg">
        {t("backToSignIn")}
      </Link>
    </>
  );
}
