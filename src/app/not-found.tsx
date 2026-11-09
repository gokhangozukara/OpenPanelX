import Link from "next/link";
import { Logo } from "@/components/logo";
import { getT } from "@/lib/i18n";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("notFoundTitle") };
}

export default async function NotFound() {
  const { t } = await getT();
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 px-4 text-center">
      <Logo size="lg" />
      <div>
        <h1 className="text-lg font-semibold tracking-tight">{t("notFoundTitle")}</h1>
        <p className="mt-1 text-sm text-muted">{t("notFoundText")}</p>
      </div>
      <Link href="/" className="btn">
        {t("backHome")}
      </Link>
    </div>
  );
}
