"use client";

import { useAuth } from "../providers";
import { useRouter, usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    if (!user) {
      router.push("/");
    } else if (user.role !== "admin") {
      router.push(`/${user.role}`);
    }
  }, [user, router]);

  if (!mounted || !user || user.role !== "admin") {
    return null;
  }

  const handleLogout = () => {
    logout();
    router.push("/");
  };

  return (
    <div className="min-h-screen bg-surface font-body-md text-on-surface">
      <header className="fixed top-0 w-full z-50 bg-white/80 backdrop-blur-xl pt-safe shadow-[0_1px_8px_rgba(0,0,0,0.04)]">
        <div className="h-14 px-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" fill="white" className="font-headline-md text-[10px]">HC</text>
              </svg>
            </div>
            <h1 className="font-headline-md text-headline-md text-primary tracking-tight hidden sm:block">
              Health care Admin
            </h1>
            
            <nav className="hidden md:flex items-center ml-8 space-x-1">
              <Link
                href="/admin"
                className={`px-3 py-2 rounded-md font-label-sm text-label-sm transition-colors ${
                  pathname === "/admin" 
                    ? "bg-primary-container text-on-primary-container" 
                    : "text-on-surface hover:bg-surface-variant"
                }`}
              >
                Dashboard
              </Link>
              <Link
                href="/admin/doctors"
                className={`px-3 py-2 rounded-md font-label-sm text-label-sm transition-colors ${
                  pathname === "/admin/doctors" 
                    ? "bg-primary-container text-on-primary-container" 
                    : "text-on-surface hover:bg-surface-variant"
                }`}
              >
                Doctors
              </Link>
              <Link
                href="/admin/leaves"
                className={`px-3 py-2 rounded-md font-label-sm text-label-sm transition-colors ${
                  pathname === "/admin/leaves" 
                    ? "bg-primary-container text-on-primary-container" 
                    : "text-on-surface hover:bg-surface-variant"
                }`}
              >
                Leaves
              </Link>
            </nav>
          </div>

          <div className="flex items-center gap-4">
             <button 
                onClick={handleLogout}
                className="text-error hover:bg-error-container hover:text-on-error-container px-3 py-2 rounded-md font-label-sm text-label-sm transition-colors flex items-center gap-1"
             >
                <span className="material-symbols-outlined text-[18px]">logout</span>
                <span className="hidden sm:inline">Sign out</span>
             </button>
          </div>
        </div>
        {/* Mobile Navigation */}
        <div className="md:hidden flex overflow-x-auto px-4 py-2 border-t border-surface-variant gap-2 bg-white/80 backdrop-blur-xl">
           <Link
                href="/admin"
                className={`px-3 py-1.5 rounded-full whitespace-nowrap font-label-sm text-label-sm transition-colors ${
                  pathname === "/admin" 
                    ? "bg-primary-container text-on-primary-container" 
                    : "bg-surface-variant text-on-surface"
                }`}
              >
                Dashboard
              </Link>
              <Link
                href="/admin/doctors"
                className={`px-3 py-1.5 rounded-full whitespace-nowrap font-label-sm text-label-sm transition-colors ${
                  pathname === "/admin/doctors" 
                    ? "bg-primary-container text-on-primary-container" 
                    : "bg-surface-variant text-on-surface"
                }`}
              >
                Doctors
              </Link>
              <Link
                href="/admin/leaves"
                className={`px-3 py-1.5 rounded-full whitespace-nowrap font-label-sm text-label-sm transition-colors ${
                  pathname === "/admin/leaves" 
                    ? "bg-primary-container text-on-primary-container" 
                    : "bg-surface-variant text-on-surface"
                }`}
              >
                Leaves
              </Link>
        </div>
      </header>

      <main className="relative pt-[104px] md:pt-20 px-4 pb-12 w-full max-w-6xl mx-auto">
        {children}
      </main>
    </div>
  );
}
