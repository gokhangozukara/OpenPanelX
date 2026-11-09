import { redirect } from "next/navigation";
import { ActionForm, Field } from "@/components/forms";
import { userCount } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { setupAdmin } from "../../actions";

export const metadata = { title: "Setup" };

export default async function SetupPage() {
  if (userCount() > 0) redirect("/login");
  const { t } = await getT();
  return (
    <>
      <h1 className="text-lg font-semibold tracking-tight">{t("setupTitle")}</h1>
      <p className="mt-1 mb-6 text-sm text-muted">{t("setupHint")}</p>
      <ActionForm action={setupAdmin} submit={t("createAdmin")}>
        <Field name="username" label={t("username")} autoComplete="username" minLength={3} />
        <Field name="password" label={t("password")} type="password" autoComplete="new-password" minLength={8} />
      </ActionForm>
    </>
  );
}
