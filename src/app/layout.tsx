import type { Metadata } from "next";
import "./globals.css";
import { Sidebar } from "@/components/layout/Sidebar";

export const metadata: Metadata = {
  title: "CommitPilot AI",
  description:
    "Conversational repository analysis and code review for Alan AI, powered by open models.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-citron focus:px-3 focus:py-2 focus:text-black"
        >
          Skip to content
        </a>
        <div className="min-h-screen lg:grid lg:grid-cols-[248px_minmax(0,1fr)]">
          <Sidebar />
          <main id="main" className="min-w-0 pb-16">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
