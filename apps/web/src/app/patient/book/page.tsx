"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiFetch, useAuth } from "../../providers";
import { useRouter } from "next/navigation";

// Utility for Idempotency Key
function uuidv4() {
  return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
    (
      +c ^
      (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (+c / 4)))
    ).toString(16)
  );
}

export default function BookAppointmentPage() {
  const { token } = useAuth();
  const router = useRouter();
  
  const [specialisation, setSpecialisation] = useState("");
  const [selectedDoctorId, setSelectedDoctorId] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<any | null>(null);
  
  // Hold state
  const [holdToken, setHoldToken] = useState<string | null>(null);
  const [holdExpiresAt, setHoldExpiresAt] = useState<Date | null>(null);
  const [countdown, setCountdown] = useState(600);
  
  // Form state
  const [rawSymptoms, setRawSymptoms] = useState("");
  const [durationDays, setDurationDays] = useState<number | "">(1);
  const [severity, setSeverity] = useState<number | "">(5);
  const [idempotencyKey, setIdempotencyKey] = useState("");

  useEffect(() => {
    setIdempotencyKey(uuidv4());
  }, []);

  // ── Queries ─────────────────────────────────────────────
  const { data: specialisations } = useQuery({
    queryKey: ["specialisations"],
    queryFn: () => apiFetch("/specialisations"),
  });

  const { data: doctors } = useQuery({
    queryKey: ["doctors", specialisation],
    queryFn: () => {
      const q = new URLSearchParams();
      if (specialisation) q.set("specialisation", specialisation);
      return apiFetch(`/doctors?${q.toString()}`);
    },
  });

  const { data: slots } = useQuery({
    queryKey: ["slots", selectedDoctorId],
    queryFn: () => apiFetch(`/doctors/${selectedDoctorId}/slots`),
    enabled: !!selectedDoctorId,
  });

  // ── Mutations ───────────────────────────────────────────
  const holdMutation = useMutation({
    mutationFn: (slotId: string) =>
      apiFetch(`/slots/${slotId}/hold`, {
        method: "POST",
        token: token!,
      }),
    onSuccess: (data) => {
      setHoldToken(data.holdToken);
      setHoldExpiresAt(new Date(data.expiresAt));
      setCountdown(Math.floor((new Date(data.expiresAt).getTime() - Date.now()) / 1000));
    },
    onError: (err: any) => {
      alert(err.title || "Failed to hold slot. It may have just been booked.");
      setSelectedSlot(null);
    }
  });

  const confirmMutation = useMutation({
    mutationFn: () =>
      apiFetch("/appointments", {
        method: "POST",
        token: token!,
        headers: {
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({
          holdToken,
          symptoms: {
            rawSymptoms,
            durationDays: durationDays === "" ? undefined : durationDays,
            severity: severity === "" ? undefined : severity,
          }
        }),
      }),
    onSuccess: () => {
      router.push("/patient");
    },
    onError: (err: any) => {
      alert(err.title || "Failed to confirm booking.");
    }
  });

  // Countdown timer
  useEffect(() => {
    if (!holdExpiresAt) return;
    const interval = setInterval(() => {
      const left = Math.floor((holdExpiresAt.getTime() - Date.now()) / 1000);
      if (left <= 0) {
        setHoldToken(null);
        setHoldExpiresAt(null);
        setSelectedSlot(null);
        alert("Hold expired. Please select a slot again.");
      } else {
        setCountdown(left);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [holdExpiresAt]);

  const handleSlotSelect = (slot: any) => {
    if (slot.status !== "available") return;
    setSelectedSlot(slot);
    holdMutation.mutate(slot.id);
  };

  const handleConfirm = (e: React.FormEvent) => {
    e.preventDefault();
    if (!holdToken) return;
    confirmMutation.mutate();
  };

  // Render stages
  if (holdToken) {
    const mins = Math.floor(countdown / 60);
    const secs = countdown % 60;
    const progress = (countdown / 600) * 100;

    return (
      <div className="flex flex-col gap-6 w-full max-w-2xl mx-auto">
        <div className="bg-primary-container text-on-primary-container p-4 rounded-xl relative overflow-hidden flex justify-between items-center shadow-sm">
          <div className="font-body-md z-10 font-medium">
            Slot held for {new Date(selectedSlot.startTs).toLocaleTimeString("en-GB", { hour: '2-digit', minute: '2-digit' })}
          </div>
          <div className="font-data-table text-lg font-bold z-10">
            {mins}:{secs.toString().padStart(2, "0")}
          </div>
          <div className="absolute top-0 left-0 bottom-0 bg-primary/20 transition-all duration-1000 ease-linear" style={{ width: `${progress}%` }} />
        </div>

        <div className="bg-surface-container-lowest border border-surface-variant rounded-xl p-6 shadow-sm">
          <h2 className="font-headline-lg text-headline-lg text-on-surface mb-2">Describe your symptoms</h2>
          <p className="text-on-surface-variant font-body-md mb-6">
            Please be as descriptive as possible. This helps your doctor prepare for the consultation.
          </p>

          <form onSubmit={handleConfirm}>
            <div className="mb-5">
              <label className="font-label-sm text-label-sm text-on-surface-variant uppercase mb-2 block">
                What are your main symptoms?
              </label>
              <textarea
                className="w-full bg-white border border-outline-variant rounded-md px-3 py-2 text-body-md focus:border-primary focus:outline-none min-h-[120px] resize-y"
                required
                placeholder="e.g. Sharp pain in lower back, started this morning..."
                value={rawSymptoms}
                onChange={(e) => setRawSymptoms(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-4 mb-8">
              <div>
                <label className="font-label-sm text-label-sm text-on-surface-variant uppercase mb-2 block">
                  Duration (days)
                </label>
                <input
                  type="number"
                  className="w-full bg-white border border-outline-variant rounded-md px-3 py-2 text-body-md focus:border-primary focus:outline-none"
                  min="1"
                  max="365"
                  required
                  value={durationDays}
                  onChange={(e) => {
                    const val = parseInt(e.target.value);
                    setDurationDays(Number.isNaN(val) ? "" : val);
                  }}
                />
              </div>
              <div>
                <label className="font-label-sm text-label-sm text-on-surface-variant uppercase mb-2 block">
                  Severity (1-10)
                </label>
                <input
                  type="number"
                  className="w-full bg-white border border-outline-variant rounded-md px-3 py-2 text-body-md focus:border-primary focus:outline-none"
                  min="1"
                  max="10"
                  required
                  value={severity}
                  onChange={(e) => {
                    const val = parseInt(e.target.value);
                    setSeverity(Number.isNaN(val) ? "" : val);
                  }}
                />
              </div>
            </div>

            <div className="flex justify-between items-center pt-4 border-t border-surface-variant">
              <button
                type="button"
                className="text-on-surface hover:bg-surface-variant font-label-sm text-[14px] px-4 py-2 rounded-md transition-colors"
                onClick={() => {
                  setHoldToken(null);
                  setHoldExpiresAt(null);
                  setSelectedSlot(null);
                  // Optional: call release hold API to be nice
                }}
              >
                Cancel
              </button>
              <button 
                type="submit" 
                className="bg-primary text-on-primary font-label-sm text-[14px] px-6 py-2.5 rounded-md hover:bg-primary-container transition-colors disabled:opacity-50 shadow-sm" 
                disabled={confirmMutation.isPending}
              >
                {confirmMutation.isPending ? "Confirming..." : "Confirm Booking"}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  // Doctor + Slot selection
  return (
    <div className="flex flex-col gap-6">
      <div className="flex gap-4">
        <div className="flex-1 md:max-w-xs">
          <label className="font-label-sm text-label-sm text-on-surface-variant uppercase mb-2 block">
            Specialisation
          </label>
          <select
            className="w-full bg-white border border-outline-variant rounded-md px-3 py-2 text-body-md focus:border-primary focus:outline-none"
            value={specialisation}
            onChange={(e) => {
              setSpecialisation(e.target.value);
              setSelectedDoctorId(null);
            }}
          >
            <option value="">All specialisations</option>
            {specialisations?.map((s: any) => (
              <option key={s.name} value={s.name}>{s.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[300px_1fr] gap-6">
        {/* Doctor List */}
        <div>
          <h2 className="font-headline-md text-headline-md text-on-surface mb-4">Select Doctor</h2>
          <div className="flex flex-col gap-3">
            {doctors?.map((doc: any) => (
              <div
                key={doc.id}
                className={`border rounded-xl p-4 cursor-pointer transition-colors shadow-sm ${
                  selectedDoctorId === doc.id 
                    ? "border-primary bg-primary-container/10" 
                    : "border-surface-variant bg-surface-container-lowest hover:border-outline"
                }`}
                onClick={() => setSelectedDoctorId(doc.id)}
              >
                <div className="font-body-lg font-medium text-on-surface mb-1">{doc.fullName}</div>
                <div className="font-body-md text-[13px] text-on-surface-variant">
                  {doc.specialisation} • {doc.qualification}
                </div>
              </div>
            ))}
            {doctors?.length === 0 && (
              <p className="text-on-surface-variant font-body-md">No doctors found.</p>
            )}
          </div>
        </div>

        {/* Slot Grid */}
        <div>
          {selectedDoctorId ? (
            <>
              <h2 className="font-headline-md text-headline-md text-on-surface mb-4">Select Time</h2>
              {!slots ? (
                <div className="bg-surface-variant animate-pulse rounded-xl h-[400px]" />
              ) : slots.length === 0 ? (
                <div className="bg-surface-container-lowest border border-surface-variant rounded-xl p-8 text-center text-on-surface-variant font-body-md">
                  No available slots for this doctor.
                </div>
              ) : (
                <div className="flex flex-col gap-6">
                  {/* Group slots by day */}
                  {Object.entries(
                    slots.reduce((acc: any, slot: any) => {
                      const dateStr = new Date(slot.startTs).toLocaleDateString();
                      if (!acc[dateStr]) acc[dateStr] = [];
                      acc[dateStr].push(slot);
                      return acc;
                    }, {})
                  ).map(([dateStr, daySlots]: [string, any]) => (
                    <div key={dateStr} className="bg-surface-container-lowest border border-surface-variant p-4 rounded-xl shadow-sm">
                      <div className="font-label-sm text-label-sm text-on-surface-variant uppercase mb-4 border-b border-surface-variant pb-2">
                        {new Date((daySlots as any)[0].startTs).toLocaleDateString("en-GB", { weekday: 'long', month: 'short', day: 'numeric' })}
                      </div>
                      <div className="grid grid-cols-[repeat(auto-fill,minmax(100px,1fr))] gap-3">
                        {(daySlots as any).map((slot: any) => {
                          const time = new Date(slot.startTs).toLocaleTimeString("en-GB", { hour: '2-digit', minute: '2-digit' });
                          return (
                            <button
                              key={slot.id}
                              className={`font-data-table px-3 py-2.5 rounded-[8px] text-sm text-center transition-all ${
                                slot.status === "available"
                                  ? "bg-surface border border-surface-variant hover:border-primary hover:text-primary hover:bg-primary/5 text-on-surface"
                                  : "bg-surface-variant/50 text-on-surface-variant opacity-60 cursor-not-allowed"
                              }`}
                              disabled={slot.status !== "available" || holdMutation.isPending}
                              onClick={() => handleSlotSelect(slot)}
                            >
                              {time}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="h-[200px] md:h-full min-h-[300px] flex items-center justify-center bg-surface-container-lowest rounded-xl border border-dashed border-outline-variant text-on-surface-variant font-body-md">
              Select a doctor to view availability
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
