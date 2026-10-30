import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "FaultLane — Find failures before users do.",
  description: "Local API failure testing with real browser evidence.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>
    <div className="app-shell">
      <aside className="sidebar">
        <Link href="/results" className="brand"><span className="brand-mark">ϟ</span> FaultLane<span className="version">0.4</span></Link>
        <div className="workspace"><span className="workspace-icon">L</span><div>Local workspace<small>On your machine</small></div><span className="online-dot" /></div>
        <span className="nav-label">WORKSPACE</span>
        <nav aria-label="Main navigation"><Link href="/results"><span>◫</span> Test results</Link><Link href="/demo"><span>▤</span> Demo application</Link></nav>
        <div className="sidebar-bottom"><span className="online-dot" /> Local-first by design<small>No cloud. No account. Your evidence.</small></div>
      </aside>
      <div className="main-shell"><header className="topbar"><span>Workspace <span className="slash">/</span> <strong>FaultLane</strong></span><span className="local-badge">LOCAL ENVIRONMENT</span></header><main>{children}</main><footer>FaultLane <span>Find failures before users do.</span><span className="footer-right">Browser evidence. Explicit assertions.</span></footer></div>
    </div>
  </body></html>;
}
