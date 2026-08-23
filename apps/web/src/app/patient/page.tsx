"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch, useAuth } from "../providers";
import Link from "next/link";

export default function PatientDashboard() {
  const { token } = useAuth();
  const queryClient = useQueryClient();

  const { data: appointments, isLoading: apptsLoading } = useQuery({
    queryKey: ["appointments"],
    queryFn: () => apiFetch("/appointments", { token: token! }),
    enabled: !!token,
  });

  const { data: medications, isLoading: medsLoading } = useQuery({
    queryKey: ["medications"],
    queryFn: () => apiFetch("/patients/me/medications", { token: token! }),
    enabled: !!token,
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/appointments/${id}/cancel`, {
        method: "POST",
        token: token!,
        body: JSON.stringify({ reason: "Patient requested cancellation" }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["appointments"] });
    },
  });

  const upcoming = appointments?.filter(
    (a: any) => a.status === "scheduled" || a.status === "checked_in"
  ) || [];

  const past = appointments?.filter(
    (a: any) => a.status === "completed" || a.status.startsWith("cancelled")
  ) || [];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-8">
      
      {/* Main Column */}
      <div className="flex flex-col">
        <div className="flex justify-between items-baseline mb-6">
          <h2 className="font-headline-lg text-headline-lg text-on-surface">Upcoming Appointments</h2>
          <Link href="/patient/book" className="bg-primary text-on-primary font-label-sm text-[14px] px-4 py-2 rounded-md hover:bg-primary-container transition-colors">
            Book new
          </Link>
        </div>

        {apptsLoading ? (
          <div className="bg-surface-variant animate-pulse rounded-xl h-[120px]" />
        ) : upcoming.length === 0 ? (
          <div className="bg-surface-container-lowest border border-surface-variant rounded-xl p-8 text-center">
            <p className="text-on-surface-variant font-body-md mb-4">You have no upcoming appointments.</p>
            <Link href="/patient/book" className="bg-surface-variant text-on-surface hover:bg-outline-variant font-label-sm text-[14px] px-4 py-2 rounded-md transition-colors inline-block">
              Find a doctor
            </Link>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {upcoming.map((appt: any) => (
              <div key={appt.id} className="bg-surface-container-lowest border border-surface-variant rounded-xl p-5 hover:border-outline transition-colors group">
                <div className="flex justify-between items-start">
                  <div>
                    <div className="font-label-sm text-label-sm text-primary uppercase mb-2">
                      {new Date(appt.startTs).toLocaleDateString("en-GB", { weekday: 'short', day: 'numeric', month: 'short' })}
                    </div>
                    <h3 className="font-headline-md text-headline-md text-on-surface mb-1 flex items-center gap-2">
                      <span className="font-data-table font-semibold">{new Date(appt.startTs).toLocaleTimeString("en-GB", { hour: '2-digit', minute: '2-digit' })}</span>
                      <span className="text-on-surface-variant">•</span>
                      <span>{appt.doctor.name}</span>
                    </h3>
                    <p className="font-body-md text-sm text-on-surface-variant">{appt.doctor.specialisation}</p>
                  </div>
                  
                  {appt.status === "scheduled" && (
                    <button
                      className="text-error font-label-sm text-[13px] hover:underline px-3 py-1.5 rounded-md disabled:opacity-50"
                      onClick={() => {
                        if (confirm("Are you sure you want to cancel this appointment?")) {
                          cancelMutation.mutate(appt.id);
                        }
                      }}
                      disabled={cancelMutation.isPending}
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        <h2 className="font-headline-lg text-headline-lg text-on-surface mt-10 mb-6">Past Visits</h2>
        
        {apptsLoading ? (
          <div className="bg-surface-variant animate-pulse rounded-xl h-[120px]" />
        ) : past.length === 0 ? (
          <div className="bg-surface-container-lowest border border-surface-variant rounded-xl p-8 text-center">
            <p className="text-on-surface-variant font-body-md">No past visits.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {past.map((appt: any) => (
              <div key={appt.id} className="bg-surface-container-lowest border border-surface-variant rounded-xl p-4 flex justify-between items-center hover:border-outline transition-colors">
                <div>
                  <h3 className="font-headline-md text-base text-on-surface mb-1">
                    {new Date(appt.startTs).toLocaleDateString("en-GB", { day: 'numeric', month: 'short', year: 'numeric' })}
                  </h3>
                  <p className="font-body-md text-sm text-on-surface-variant">{appt.doctor.name}</p>
                </div>
                <div>
                  {appt.status === "completed" ? (
                    <Link href={`/patient/visits/${appt.id}`} className="text-primary font-label-sm text-[13px] hover:underline px-3 py-1.5">
                      View summary
                    </Link>
                  ) : (
                    <span className="inline-flex items-center px-2 py-1 rounded-[6px] font-label-sm text-[12px] bg-surface-variant text-on-surface">
                      {appt.status === "cancelled_by_patient" ? "Cancelled by you" : "Cancelled by clinic"}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Right Column: Medications */}
      <div>
        <div className="bg-surface rounded-xl p-5 border border-surface-variant sticky top-24">
          <h2 className="font-headline-md text-headline-md text-on-surface mb-5">Medication Reminders</h2>
          
          {medsLoading ? (
            <div className="bg-surface-variant animate-pulse rounded-xl h-[60px] mb-2" />
          ) : !medications || medications.length === 0 ? (
            <p className="font-body-md text-[14px] text-on-surface-variant">No upcoming medications.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {medications.map((med: any) => (
                <div key={med.id} className="bg-surface-container-lowest border border-surface-variant rounded-xl p-4 flex gap-3 items-center hover:border-outline transition-colors">
                  <div className="w-10 h-10 rounded-full bg-primary-container text-on-primary-container flex items-center justify-center text-[18px]">
                    💊
                  </div>
                  <div>
                    <div className="font-data-sm text-[12px] text-on-surface-variant mb-0.5">
                      {new Date(med.dueAt).toLocaleTimeString("en-GB", { hour: '2-digit', minute: '2-digit' })}
                    </div>
                    <div className="font-body-md font-medium text-on-surface">{med.drugName}</div>
                    <div className="font-body-md text-[13px] text-on-surface-variant">{med.doseText}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

    </div>
  );
}
