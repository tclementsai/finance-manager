"use client";
import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";

const PUBLIC_PATHS = ["/login", "/signup"];

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem("ledger-token");
    if (!token && !PUBLIC_PATHS.includes(pathname)) {
      router.replace("/login");
    } else {
      setChecked(true);
    }
  }, [pathname, router]);

  if (!checked && !PUBLIC_PATHS.includes(pathname)) {
    return null; // Avoid flash of content before redirect
  }

  return <>{children}</>;
}
