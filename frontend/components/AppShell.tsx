"use client";
import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { Nav } from "@/components/Nav";

export function AppShell({ children }: { children: React.ReactNode }) {
  const { token, ready } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  const isLoginPage = pathname === "/login" || pathname === "/signup";

  useEffect(() => {
    if (!ready) return;
    if (!token && !isLoginPage) {
      router.replace("/login");
    } else if (token && isLoginPage) {
      router.replace("/");
    }
  }, [ready, token, isLoginPage, router]);

  if (!ready) return null;
  if (isLoginPage) return <>{children}</>;
  if (!token) return null;

  return (
    <div className="flex min-h-screen">
      <Nav />
      <main className="flex-1 min-w-0 p-4 md:p-8 max-w-[1400px] mx-auto app-main">{children}</main>
    </div>
  );
}
