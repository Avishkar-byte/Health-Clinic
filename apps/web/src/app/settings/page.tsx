"use client";

import { Suspense, useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch, useAuth } from "../providers";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

export default function SettingsPage() {
  return (
    <Suspense fallback={null}>
      <SettingsPageInner />
    </Suspense>
  );
}

function SettingsPageInner() {
  const { user, token } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    if (!user) router.push("/");
  }, [user, router]);

  const justConnected = searchParams.get("google") === "connected";

  const { data: status, isLoading } = useQuery({
    queryKey: ["google-status"],
    queryFn: () => apiFetch("/integrations/google/status", { token: token! }),
    enabled: !!token,
  });

  const disconnectMutation = useMutation({
    mutationFn: () => apiFetch("/integrations/google", { method: "DELETE", token: token! }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["google-status"] }),
  });

  const apiUrl = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000").replace(/\/+$/, "");

  if (!mounted || !user) return null;

  return (
    <div className="max-w-[576px] mx-auto px-4 py-8">
      <Link href={`/${user.role}`} className="inline-flex items-center text-primary font-body-md font-medium hover:underline mb-6">
        <span className="material-symbols-outlined text-[18px] mr-1">arrow_back</span>
        Back to dashboard
      </Link>

      <h1 className="font-headline-lg text-headline-lg text-on-surface mb-6">Settings</h1>

      <div className="bg-surface-container-lowest border border-surface-variant rounded-xl p-6 shadow-sm">
        <h2 className="font-headline-md text-headline-md text-on-surface mb-2">Google Calendar</h2>
        <p className="font-body-md text-on-surface-variant mb-6 text-[14px]">
          Connect your Google Calendar to automatically get an event for every appointment you book.
          Booking works either way (this is optional).
        </p>

        {justConnected && (
          <div className="p-3 bg-primary-container/20 border border-primary/20 rounded-md mb-4 text-primary font-body-md text-[14px]">
            Google Calendar connected.
          </div>
        )}

        {isLoading ? (
          <div className="bg-surface-variant animate-pulse rounded-md h-[40px]" />
        ) : !status?.configured ? (
          <p className="font-body-md text-on-surface-variant text-[14px]">
            Google Calendar isn't configured on this server yet.
          </p>
        ) : status?.connected ? (
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center px-2 py-1 rounded-[6px] font-label-sm text-[12px] bg-primary-container text-on-primary-container">
              Connected
            </span>
            <button
              className="text-error font-label-sm text-[13px] hover:underline px-3 py-1.5 rounded-md transition-colors disabled:opacity-50"
              onClick={() => disconnectMutation.mutate()}
              disabled={disconnectMutation.isPending}
            >
              Disconnect
            </button>
          </div>
        ) : (
          <a 
            href={`${apiUrl}/integrations/google/connect?token=${encodeURIComponent(token || "")}`} 
            className="inline-block bg-primary text-on-primary font-label-sm text-[14px] px-5 py-2 rounded-md hover:bg-primary-container transition-colors"
          >
            Connect Google Calendar
          </a>
        )}
      </div>
    </div>
  );
}
