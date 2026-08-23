"use client";

import { useState, useEffect } from "react";
import { useAuth, apiFetch } from "./providers";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const { user, login } = useAuth();
  const router = useRouter();
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Redirect if already logged in
  useEffect(() => {
    if (user) {
      const dashboardPaths: Record<string, string> = {
        patient: "/patient",
        doctor: "/doctor",
        admin: "/admin",
      };
      router.push(dashboardPaths[user.role] || "/patient");
    }
  }, [user, router]);

  if (user) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      if (isLogin) {
        const res = await apiFetch("/auth/login", {
          method: "POST",
          body: JSON.stringify({ email, password }),
        });
        login(res.accessToken, res.refreshToken, res.user);
      } else {
        const res = await apiFetch("/auth/register", {
          method: "POST",
          body: JSON.stringify({ email, password, fullName }),
        });
        login(res.accessToken, res.refreshToken, res.user);
      }

      // Redirect based on role
      const stored = localStorage.getItem("auth_user");
      const parsed = stored ? JSON.parse(stored) : null;
      const role = parsed?.role || "patient";
      const paths: Record<string, string> = {
        patient: "/patient",
        doctor: "/doctor",
        admin: "/admin",
      };
      router.push(paths[role] || "/patient");
    } catch (err: any) {
      setError(err.detail || err.title || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface p-4">
      <div className="w-full max-w-[380px]">
        {/* Logo area */}
        <div className="text-center mb-8 flex flex-col items-center">
          <div className="w-12 h-12 rounded-full bg-primary flex items-center justify-center mb-4">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" fill="white" className="font-headline-md text-[14px]">HC</text>
            </svg>
          </div>
          <h1 className="font-display text-headline-lg text-primary tracking-tight mb-2">
            Health care
          </h1>
          <p className="font-body-md text-on-surface-variant">
            {isLogin ? "Sign in to your account" : "Create your account"}
          </p>
        </div>

        {/* Form */}
        <div className="bg-surface-container-lowest border border-surface-variant rounded-xl p-6">
          <form onSubmit={handleSubmit}>
            {!isLogin && (
              <div className="mb-4">
                <label className="font-label-sm text-label-sm text-on-surface-variant uppercase mb-1 block">
                  Full Name
                </label>
                <input
                  className="w-full bg-[#FFFFFF] border border-[#DDE3E9] rounded-[6px] py-[10px] px-[12px] text-body-md text-on-surface focus:outline-none focus:border-primary-container transition-colors"
                  type="text"
                  id="register-name"
                  placeholder="Your name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required={!isLogin}
                />
              </div>
            )}

            <div className="mb-4">
              <label className="font-label-sm text-label-sm text-on-surface-variant uppercase mb-1 block">
                Email
              </label>
              <input
                className="w-full bg-[#FFFFFF] border border-[#DDE3E9] rounded-[6px] py-[10px] px-[12px] text-body-md text-on-surface focus:outline-none focus:border-primary-container transition-colors"
                type="email"
                id="login-email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            <div className="mb-5">
              <label className="font-label-sm text-label-sm text-on-surface-variant uppercase mb-1 block">
                Password
              </label>
              <input
                className="w-full bg-[#FFFFFF] border border-[#DDE3E9] rounded-[6px] py-[10px] px-[12px] text-body-md text-on-surface focus:outline-none focus:border-primary-container transition-colors"
                type="password"
                id="login-password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>

            {error && (
              <div className="text-error font-body-md text-[13px] mb-4 py-2 px-3 bg-error-container rounded-[6px]">
                {error}
              </div>
            )}

            <button
              type="submit"
              className="w-full bg-primary text-on-primary font-label-sm text-[14px] py-[10px] px-4 rounded-[6px] hover:bg-primary-container transition-colors"
              id="login-submit"
              disabled={loading}
            >
              {loading ? "..." : isLogin ? "Sign in" : "Create account"}
            </button>
          </form>
        </div>

        {/* Toggle */}
        <div className="text-center mt-4">
          <button
            onClick={() => {
              setIsLogin(!isLogin);
              setError("");
            }}
            className="text-primary font-body-md text-[14px] hover:underline"
          >
            {isLogin
              ? "Need an account? Sign up"
              : "Already have an account? Sign in"}
          </button>
        </div>

        {/* Quick login helpers for demo */}
        <div className="mt-6 p-4 bg-surface-container-lowest border border-surface-variant rounded-xl">
          <p className="font-label-sm text-label-sm text-on-surface-variant uppercase mb-3">
            Demo accounts
          </p>
          <div className="flex flex-col gap-2">
            {[
              { label: "Patient", email: "arjun@patient.local" },
              { label: "Doctor", email: "anand@clinic.local" },
              { label: "Admin", email: "admin@clinic.local" },
            ].map((demo) => (
              <button
                key={demo.email}
                className="flex items-center text-left bg-surface hover:bg-surface-variant transition-colors py-2 px-3 rounded-[6px] font-body-md text-[13px] text-on-surface"
                onClick={() => {
                  setEmail(demo.email);
                  setPassword("password123");
                  setIsLogin(true);
                }}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0 mr-2" />
                {demo.label} - {demo.email}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
