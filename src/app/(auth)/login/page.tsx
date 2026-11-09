import { redirect } from "next/navigation";
import { ActionForm, Field } from "@/components/forms";
import { getUser, userCount } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { signIn } from "../../actions";

export const metadata = { title: "Sign in" };

export default async function LoginPage() {
  if (userCount() === 0) redirect("/setup");
  if (await getUser()) redirect("/");
  const { t } = await getT();
  return (
    <>
      <h1 className="text-lg font-semibold tracking-tight">{t("signIn")}</h1>
      <p className="mt-1 mb-6 text-sm text-muted">{t("signInHint")}</p>
      <ActionForm action={signIn} submit={t("signIn")}>
        <Field name="username" label={t("username")} autoComplete="username" />
        <Field name="password" label={t("password")} type="password" autoComplete="current-password" />
      </ActionForm>
    </>
  );
}
