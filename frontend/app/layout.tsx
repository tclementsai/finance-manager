import "./globals.css";
import type { Metadata } from "next";
import { AuthGuard } from "@/components/AuthGuard";
import { EntityProvider } from "@/lib/entity-context";
import { AppShell } from "@/components/AppShell";

export const metadata: Metadata = {
  title: "Ledger — Finance Manager",
  description: "Income, expenses, deductions, invoicing & tax set-aside",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AuthGuard>
          <EntityProvider>
            <AppShell>{children}</AppShell>
          </EntityProvider>
        </AuthGuard>
      </body>
    </html>
  );
}
