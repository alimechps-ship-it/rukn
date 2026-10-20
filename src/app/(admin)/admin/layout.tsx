import "@fontsource-variable/inter";
import "@fontsource/ibm-plex-sans-arabic/400.css";
import "@fontsource/ibm-plex-sans-arabic/600.css";
import "./admin.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: { default: "RUKN Admin", template: "%s · RUKN Admin" },
  robots: { index: false, follow: false },
  icons: { icon: "/favicon-32.png" },
};
export const dynamic = "force-dynamic";

export default function AdminRoot({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" dir="ltr">
      <body>{children}</body>
    </html>
  );
}
