import { LangSwitch } from "@/components/lang-switch";
import { Logo } from "@/components/logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-8 px-4 py-10">
      <Logo size="lg" />
      <div className="card w-full max-w-sm p-6 sm:p-7">{children}</div>
      <LangSwitch />
    </div>
  );
}
