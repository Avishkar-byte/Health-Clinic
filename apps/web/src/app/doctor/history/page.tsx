"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch, useAuth } from "../../providers";

export default function DoctorHistoryPage() {
  const { token } = useAuth();

  const { data: appointments, isLoading } = useQuery({
    queryKey: ["doctor-appointments-all"],
    queryFn: () => apiFetch("/appointments", { token: token! }),
    enabled: !!token,
  });

  const past = (appointments || [])
    .filter((a: any) => a.status === "completed" || a.status.startsWith("cancelled") || a.status === "no_show")
    .sort((a: any, b: any) => new Date(b.startTs).getTime() - new Date(a.startTs).getTime());

  const statusLabel = (status: string) => {
    if (status === "completed") return "Completed";
    if (status === "cancelled_by_patient") return "Cancelled by patient";
    if (status === "cancelled_by_clinic") return "Cancelled by clinic";
    if (status === "no_show") return "No show";
    return status;
  };

  return (
    <div className="flex flex-col gap-4">
      <h2 className="font-headline-lg text-headline-lg text-on-surface mb-2">Visit History</h2>

      {isLoading ? (
        <div className="flex flex-col gap-4">
          <div className="bg-surface-variant animate-pulse rounded-xl h-[80px]" />
          <div className="bg-surface-variant animate-pulse rounded-xl h-[80px]" />
        </div>
      ) : past.length === 0 ? (
        <div className="bg-surface-container-lowest border border-surface-variant rounded-xl p-8 text-center">
          <p className="text-on-surface-variant font-body-md">No past visits yet.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {past.map((appt: any) => (
            <div key={appt.id} className="bg-surface-container-lowest border border-surface-variant rounded-xl p-4 flex justify-between items-center hover:border-outline transition-colors">
              <div>
                <div className="font-label-sm text-label-sm text-on-surface-variant uppercase mb-1">
                  {new Date(appt.startTs).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" })}
                  <span className="mx-2">•</span>
                  {new Date(appt.startTs).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                </div>
                <h3 className="font-headline-md text-headline-md text-on-surface">{appt.patient?.name}</h3>
              </div>
              <span
                className={`inline-flex items-center px-2 py-1 rounded-[6px] font-label-sm text-label-sm ${
                  appt.status === "completed" 
                    ? "bg-primary-container text-on-primary-container" 
                    : "bg-surface-variant text-on-surface"
                }`}
              >
                {statusLabel(appt.status)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
