"use client";
import { usePathname } from "next/navigation";
import { Nav } from "@/components/Nav";

const BARE_PATHS = ["/login", "/signup"];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  if (BARE_PATHS.includes(pathname)) {
    return <>{children}</>;
  }

  return (
    <div className="flex min-h-screen">
      <Nav />
      <main className="flex-1 p-8 max-w-[1400px]">{children}</main>
    </div>
  );
}
