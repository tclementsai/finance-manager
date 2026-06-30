import "./globals.css";
import type { Metadata } from "next";
import { AuthProvider } from "@/lib/auth-context";
import { EntityProvider } from "@/lib/entity-context";
import { AppShell } from "@/components/AppShell";

export const metadata: Metadata = {
  title: "Ledger — Finance Manager",
  description: "Income, expenses, deductions, invoicing & tax set-aside",
  viewport: "width=device-width, initial-scale=1, viewport-fit=cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
          <EntityProvider>
            <AppShell>{children}</AppShell>
          </EntityProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
