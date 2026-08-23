"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch, useAuth } from "../providers";
import Link from "next/link";

export default function DoctorDashboard() {
  const { token } = useAuth();

  const { data: appointments, isLoading } = useQuery({
    queryKey: ["doctor-appointments"],
    queryFn: () => apiFetch("/appointments?status=scheduled", { token: token! }),
    enabled: !!token,
  });

  return (
    <div className="flex flex-col gap-4">
      <h2 className="font-headline-lg text-headline-lg text-on-surface mb-2">Today's Queue</h2>
      
      {isLoading ? (
        <div className="flex flex-col gap-4">
          <div className="bg-surface-variant animate-pulse rounded-xl h-[100px]" />
          <div className="bg-surface-variant animate-pulse rounded-xl h-[100px]" />
        </div>
      ) : appointments?.length === 0 ? (
        <div className="bg-surface-container-lowest border border-surface-variant rounded-xl p-8 text-center">
          <p className="text-on-surface-variant font-body-md">No appointments scheduled for today.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {appointments?.map((appt: any) => {
            const preVisit = appt.aiSummaries?.find((s: any) => s.kind === "pre_visit");
            
            return (
              <div key={appt.id} className="bg-surface-container-lowest border border-surface-variant rounded-xl flex flex-col md:flex-row overflow-hidden hover:border-outline transition-colors">
                {/* Time gutter */}
                <div className="md:w-[120px] bg-surface p-4 border-b md:border-b-0 md:border-r border-surface-variant flex flex-col items-center justify-center">
                  <div className="font-label-sm text-label-sm text-on-surface-variant uppercase mb-1">
                    {new Date(appt.startTs).toLocaleDateString("en-GB", { weekday: 'short', month: 'short', day: 'numeric' })}
                  </div>
                  <div className="font-data-table text-headline-md text-on-surface font-semibold">
                    {new Date(appt.startTs).toLocaleTimeString("en-GB", { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>

                {/* Content */}
                <div className="p-4 flex-1 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                  <div>
                    <h3 className="font-headline-md text-headline-md text-on-surface mb-2">{appt.patient.name}</h3>
                    
                    {preVisit && preVisit.status === "ready" ? (
                      <div className="flex gap-3 items-center flex-wrap">
                        <span className={`inline-flex items-center px-2 py-1 rounded-[6px] font-label-sm text-label-sm ${
                          preVisit.urgency === "high" ? "bg-error-container text-on-error-container" : 
                          preVisit.urgency === "medium" ? "bg-[#FFF0B3] text-[#9A6700]" : 
                          "bg-[#E6F4EA] text-[#137333]"
                        }`}>
                          <span className={`w-1.5 h-1.5 rounded-full mr-2 ${
                            preVisit.urgency === "high" ? "bg-error" : 
                            preVisit.urgency === "medium" ? "bg-[#F9AB00]" : 
                            "bg-[#137333]"
                          }`}></span>
                          {preVisit.urgency === "high" ? "High Priority" : preVisit.urgency === "medium" ? "Medium Priority" : "Standard"}
                        </span>
                        <span className="font-body-md text-sm text-on-surface-variant">{preVisit.chiefComplaint}</span>
                      </div>
                    ) : (
                      <div className="flex gap-3 items-center flex-wrap">
                        <span className="inline-flex items-center px-2 py-1 rounded-[6px] font-label-sm text-label-sm bg-surface-variant text-on-surface">
                          <span className="w-1.5 h-1.5 rounded-full mr-2 bg-outline"></span>
                          {preVisit?.status === "pending" ? "Analyzing..." : "Fallback"}
                        </span>
                        <span className="font-body-md text-sm text-on-surface-variant">
                          {appt.symptoms?.rawSymptoms ? appt.symptoms.rawSymptoms.substring(0, 60) + "..." : "No symptoms reported"}
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="w-full md:w-auto">
                    <Link href={`/doctor/appointments/${appt.id}`} className="block text-center bg-primary text-on-primary font-label-sm text-[14px] px-5 py-2.5 rounded-md hover:bg-primary-container transition-colors whitespace-nowrap">
                      Review & Consult
                    </Link>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
