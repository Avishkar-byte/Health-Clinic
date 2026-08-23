"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch, useAuth } from "../../providers";

export default function AdminLeavesPage() {
  const { token } = useAuth();
  const queryClient = useQueryClient();

  const [doctorId, setDoctorId] = useState("");
  const [startTs, setStartTs] = useState("");
  const [endTs, setEndTs] = useState("");
  const [reason, setReason] = useState("");

  const { data: doctors } = useQuery({
    queryKey: ["doctors"],
    queryFn: () => apiFetch("/doctors"),
  });

  const { data: preview, isLoading: isPreviewing, isError } = useQuery({
    queryKey: ["leave-preview", doctorId, startTs, endTs],
    queryFn: () => {
      const start = new Date(startTs).toISOString();
      const end = new Date(endTs).toISOString();
      return apiFetch(`/admin/doctors/${doctorId}/leaves/preview?startTs=${start}&endTs=${end}`, { token: token! });
    },
    enabled: !!(doctorId && startTs && endTs && new Date(startTs) < new Date(endTs)),
    retry: false,
  });

  const createLeaveMutation = useMutation({
    mutationFn: () => {
      const start = new Date(startTs).toISOString();
      const end = new Date(endTs).toISOString();
      return apiFetch(`/admin/doctors/${doctorId}/leaves`, {
        method: "POST",
        token: token!,
        body: JSON.stringify({ startTs: start, endTs: end, reason }),
      });
    },
    onSuccess: (data) => {
      alert(`Leave created. ${data.cancelledAppointments} appointments cancelled.`);
      setDoctorId("");
      setStartTs("");
      setEndTs("");
      setReason("");
    },
    onError: (err: any) => {
      alert(err.title || "Failed to create leave");
    }
  });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[400px_1fr] gap-8">
      
      {/* Form */}
      <div>
        <h2 className="font-headline-md text-headline-md text-on-surface mb-2">Mark Doctor Leave</h2>
        <p className="font-body-md text-on-surface-variant mb-6">
          Marking leave will block slots and instantly cancel any existing appointments in the range. Affected patients will be notified.
        </p>

        <form className="bg-surface-container-lowest border border-surface-variant rounded-xl p-5" onSubmit={(e) => { e.preventDefault(); createLeaveMutation.mutate(); }}>
          <div className="mb-4">
            <label className="font-label-sm text-label-sm text-on-surface-variant uppercase mb-2 block">Doctor</label>
            <select className="w-full bg-white border border-outline-variant rounded-md px-3 py-2 text-body-md focus:border-primary focus:outline-none" required value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
              <option value="">Select doctor...</option>
              {doctors?.map((doc: any) => (
                <option key={doc.id} value={doc.id}>{doc.fullName} ({doc.specialisation})</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="font-label-sm text-label-sm text-on-surface-variant uppercase mb-2 block">Start Time</label>
              <input type="datetime-local" className="w-full bg-white border border-outline-variant rounded-md px-3 py-2 text-body-md focus:border-primary focus:outline-none" required value={startTs} onChange={(e) => setStartTs(e.target.value)} />
            </div>
            <div>
              <label className="font-label-sm text-label-sm text-on-surface-variant uppercase mb-2 block">End Time</label>
              <input type="datetime-local" className="w-full bg-white border border-outline-variant rounded-md px-3 py-2 text-body-md focus:border-primary focus:outline-none" required value={endTs} onChange={(e) => setEndTs(e.target.value)} />
            </div>
          </div>

          <div className="mb-6">
            <label className="font-label-sm text-label-sm text-on-surface-variant uppercase mb-2 block">Reason (Optional)</label>
            <input type="text" className="w-full bg-white border border-outline-variant rounded-md px-3 py-2 text-body-md focus:border-primary focus:outline-none" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Medical conference" />
          </div>

          <button 
            type="submit" 
            className="w-full bg-primary text-on-primary font-label-sm text-[14px] px-5 py-2.5 rounded-md hover:bg-primary-container transition-colors disabled:opacity-50"
            disabled={!doctorId || !startTs || !endTs || isPreviewing || isError || createLeaveMutation.isPending}
          >
            {createLeaveMutation.isPending ? "Processing..." : "Confirm Leave"}
          </button>
        </form>
      </div>

      {/* Blast Radius Preview */}
      <div>
        <h2 className="font-headline-md text-headline-md text-on-surface mb-4">Blast Radius</h2>
        
        {!doctorId || !startTs || !endTs ? (
          <div className="p-6 bg-surface-container rounded-xl text-on-surface-variant text-center font-body-md">
            Select a doctor and time range to preview affected appointments.
          </div>
        ) : isPreviewing ? (
          <div className="bg-surface-variant animate-pulse rounded-xl h-[200px]" />
        ) : isError ? (
          <div className="p-4 bg-error-container/20 text-error rounded-xl font-body-md border border-error">
            Invalid date range.
          </div>
        ) : (
          <div className={`bg-surface-container-lowest border rounded-xl p-6 ${preview?.cancelledAppointments > 0 ? "border-error" : "border-surface-variant"}`}>
            <div className="flex items-center gap-3 mb-6">
              <div className={`text-[32px] font-semibold font-data-table ${preview?.cancelledAppointments > 0 ? "text-error" : "text-[#137333]"}`}>
                {preview?.cancelledAppointments}
              </div>
              <div className="text-[16px] text-on-surface-variant font-body-md">
                Appointments will be automatically cancelled.
              </div>
            </div>

            {preview?.cancelledAppointments > 0 && (
              <>
                <div className="font-label-sm text-label-sm text-on-surface-variant uppercase mb-3">Affected Patients</div>
                <div className="flex flex-col gap-3">
                  {preview.affectedPatients.map((p: any) => (
                    <div key={p.appointmentId} className="flex justify-between items-center pb-3 border-b border-surface-variant last:border-b-0 last:pb-0">
                      <div className="font-body-md font-medium text-on-surface">{p.patientName}</div>
                      <div className="font-data-sm text-[13px] text-on-surface-variant">
                        {new Date(p.appointmentTime).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>

    </div>
  );
}
