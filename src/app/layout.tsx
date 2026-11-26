import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { getLang } from "@/lib/i18n";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "OpenPanelX", template: "%s · OpenPanelX" },
  description: "Minimal, plugin-ready admin panel with sign-in and roles built in.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#fafafa",
};

// Applies the saved theme before first paint so there is no light/dark flash.
const THEME_SCRIPT = `try{var t=localStorage.getItem("opx_theme");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const lang = await getLang();
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang={lang} suppressHydrationWarning>
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
