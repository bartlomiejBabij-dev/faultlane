import type { ReactNode } from "react";
export default function Layout({ children }: { children: ReactNode }) {
  return <html lang="en"><body style={{ fontFamily: "system-ui", padding: 36, maxWidth: 720, margin: "auto" }}>{children}</body></html>;
}
