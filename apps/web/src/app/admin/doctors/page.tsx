"use client";

import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch, useAuth } from "../../providers";

const WEEKDAYS = [
  { value: 0, label: "Sunday" },
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
];

function todayIso() {
  return new Date().toISOString().split("T")[0];
}

export default function AdminDoctorsPage() {
  const { token } = useAuth();
  const queryClient = useQueryClient();

  const [selectedDoctorId, setSelectedDoctorId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);

  const { data: doctors, isLoading: doctorsLoading } = useQuery({
    queryKey: ["doctors"],
    queryFn: () => apiFetch("/doctors"),
  });

  const { data: specialisations } = useQuery({
    queryKey: ["specialisations"],
    queryFn: () => apiFetch("/specialisations"),
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex justify-between items-baseline">
        <h2 className="font-headline-lg text-headline-lg text-on-surface">Doctors</h2>
        <button 
          className="bg-primary text-on-primary font-label-sm text-[14px] px-4 py-2 rounded-md hover:bg-primary-container transition-colors" 
          onClick={() => setShowAddForm((s) => !s)}
        >
          {showAddForm ? "Cancel" : "+ Add Doctor"}
        </button>
      </div>

      {showAddForm && (
        <AddDoctorForm
          specialisations={specialisations}
          token={token!}
          onCreated={() => {
            setShowAddForm(false);
            queryClient.invalidateQueries({ queryKey: ["doctors"] });
          }}
        />
      )}

      <div className={`grid gap-6 ${selectedDoctorId ? "grid-cols-1 lg:grid-cols-2" : "grid-cols-1"}`}>
        <div>
          {doctorsLoading ? (
            <div className="bg-surface-variant animate-pulse rounded-xl h-[200px]" />
          ) : doctors?.length === 0 ? (
            <p className="text-on-surface-variant font-body-md">No doctors yet.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {doctors?.map((doc: any) => (
                <div
                  key={doc.id}
                  className={`bg-surface-container-lowest border rounded-xl p-4 flex justify-between items-center cursor-pointer transition-colors ${
                    selectedDoctorId === doc.id ? "border-primary bg-primary/5" : "border-surface-variant hover:border-outline"
                  }`}
                  onClick={() => setSelectedDoctorId(doc.id)}
                >
                  <div>
                    <div className="font-body-lg font-medium text-on-surface">{doc.fullName}</div>
                    <div className="font-body-md text-on-surface-variant text-[13px]">
                      {doc.specialisation} • {doc.email}
                    </div>
                  </div>
                  <button className="text-primary font-label-sm text-[13px] hover:underline px-3 py-1.5">
                    Manage Availability
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {selectedDoctorId && (
          <AvailabilityEditor
            doctorId={selectedDoctorId}
            token={token!}
            doctorName={doctors?.find((d: any) => d.id === selectedDoctorId)?.fullName}
            onClose={() => setSelectedDoctorId(null)}
          />
        )}
      </div>
    </div>
  );
}

function AddDoctorForm({
  specialisations,
  token,
  onCreated,
}: {
  specialisations: any;
  token: string;
  onCreated: () => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [specialisationId, setSpecialisationId] = useState("");
  const [registrationNo, setRegistrationNo] = useState("");
  const [qualification, setQualification] = useState("");
  const [consultationFee, setConsultationFee] = useState(500);
  const [slotDurationMin, setSlotDurationMin] = useState(30);

  const createMutation = useMutation({
    mutationFn: () =>
      apiFetch("/admin/doctors", {
        method: "POST",
        token,
        body: JSON.stringify({
          email,
          password,
          fullName,
          phone: phone || undefined,
          specialisationId,
          registrationNo,
          qualification,
          consultationFee,
          slotDurationMin,
        }),
      }),
    onSuccess: () => onCreated(),
    onError: (err: any) => {
      alert(err.title || "Failed to create doctor");
    },
  });

  return (
    <form
      className="bg-surface-container-lowest border border-surface-variant rounded-xl p-5 mb-4"
      onSubmit={(e) => {
        e.preventDefault();
        createMutation.mutate();
      }}
    >
      <h3 className="font-headline-md text-headline-md text-on-surface mb-4">New Doctor</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <div>
          <label className="font-label-sm text-label-sm text-on-surface-variant uppercase mb-2 block">Full Name</label>
          <input className="w-full bg-white border border-outline-variant rounded-md px-3 py-2 text-body-md focus:border-primary focus:outline-none" required value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Dr. Jane Doe" />
        </div>
        <div>
          <label className="font-label-sm text-label-sm text-on-surface-variant uppercase mb-2 block">Email</label>
          <input type="email" className="w-full bg-white border border-outline-variant rounded-md px-3 py-2 text-body-md focus:border-primary focus:outline-none" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <label className="font-label-sm text-label-sm text-on-surface-variant uppercase mb-2 block">Temporary Password</label>
          <input type="text" className="w-full bg-white border border-outline-variant rounded-md px-3 py-2 text-body-md focus:border-primary focus:outline-none" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" />
        </div>
        <div>
          <label className="font-label-sm text-label-sm text-on-surface-variant uppercase mb-2 block">Phone (optional)</label>
          <input className="w-full bg-white border border-outline-variant rounded-md px-3 py-2 text-body-md focus:border-primary focus:outline-none" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <div>
          <label className="font-label-sm text-label-sm text-on-surface-variant uppercase mb-2 block">Specialisation</label>
          <select className="w-full bg-white border border-outline-variant rounded-md px-3 py-2 text-body-md focus:border-primary focus:outline-none" required value={specialisationId} onChange={(e) => setSpecialisationId(e.target.value)}>
            <option value="">Select...</option>
            {specialisations?.map((s: any) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="font-label-sm text-label-sm text-on-surface-variant uppercase mb-2 block">Registration No.</label>
          <input className="w-full bg-white border border-outline-variant rounded-md px-3 py-2 text-body-md focus:border-primary focus:outline-none" required value={registrationNo} onChange={(e) => setRegistrationNo(e.target.value)} placeholder="MED006" />
        </div>
        <div>
          <label className="font-label-sm text-label-sm text-on-surface-variant uppercase mb-2 block">Qualification</label>
          <input className="w-full bg-white border border-outline-variant rounded-md px-3 py-2 text-body-md focus:border-primary focus:outline-none" required value={qualification} onChange={(e) => setQualification(e.target.value)} placeholder="MBBS, MD" />
        </div>
        <div>
          <label className="font-label-sm text-label-sm text-on-surface-variant uppercase mb-2 block">Consultation Fee</label>
          <input type="number" className="w-full bg-white border border-outline-variant rounded-md px-3 py-2 text-body-md focus:border-primary focus:outline-none" min={0} value={consultationFee} onChange={(e) => setConsultationFee(parseInt(e.target.value) || 0)} />
        </div>
        <div>
          <label className="font-label-sm text-label-sm text-on-surface-variant uppercase mb-2 block">Slot Duration (min)</label>
          <input type="number" className="w-full bg-white border border-outline-variant rounded-md px-3 py-2 text-body-md focus:border-primary focus:outline-none" min={10} max={120} value={slotDurationMin} onChange={(e) => setSlotDurationMin(parseInt(e.target.value) || 30)} />
        </div>
      </div>
      <button type="submit" className="bg-primary text-on-primary font-label-sm text-[14px] px-5 py-2.5 rounded-md hover:bg-primary-container transition-colors disabled:opacity-50" disabled={createMutation.isPending}>
        {createMutation.isPending ? "Creating..." : "Create Doctor"}
      </button>
    </form>
  );
}

function AvailabilityEditor({
  doctorId,
  doctorName,
  token,
  onClose,
}: {
  doctorId: string;
  doctorName?: string;
  token: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { data: existing, isLoading } = useQuery({
    queryKey: ["doctor-availability", doctorId],
    queryFn: () => apiFetch(`/admin/doctors/${doctorId}/availability`, { token }),
  });

  const [rows, setRows] = useState<Record<number, { enabled: boolean; startTime: string; endTime: string }>>(
    Object.fromEntries(WEEKDAYS.map((w) => [w.value, { enabled: false, startTime: "09:00", endTime: "17:00" }])),
  );

  useEffect(() => {
    if (!existing) return;
    setRows((prev) => {
      const next = { ...prev };
      for (const w of WEEKDAYS) next[w.value] = { enabled: false, startTime: "09:00", endTime: "17:00" };
      for (const a of existing) {
        next[a.weekday] = { enabled: true, startTime: a.startTime, endTime: a.endTime };
      }
      return next;
    });
  }, [existing]);

  const saveMutation = useMutation({
    mutationFn: () => {
      const slots = WEEKDAYS.filter((w) => rows[w.value].enabled).map((w) => ({
        weekday: w.value,
        startTime: rows[w.value].startTime,
        endTime: rows[w.value].endTime,
        validFrom: todayIso(),
      }));
      return apiFetch(`/admin/doctors/${doctorId}/availability`, {
        method: "PUT",
        token,
        body: JSON.stringify({ slots }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["doctor-availability", doctorId] });
      alert("Availability saved, slots are being generated for the next 60 days.");
    },
    onError: (err: any) => {
      alert(err.title || "Failed to save availability");
    },
  });

  const anyEnabled = WEEKDAYS.some((w) => rows[w.value].enabled);

  return (
    <div className="bg-surface-container-lowest border border-surface-variant rounded-xl p-5 h-fit sticky top-24">
      <div className="flex justify-between items-baseline mb-2">
        <h3 className="font-headline-md text-headline-md text-on-surface">{doctorName}'s Weekly Schedule</h3>
        <button className="text-on-surface-variant font-label-sm text-[13px] hover:text-on-surface" onClick={onClose}>Close</button>
      </div>
      <p className="text-[13px] text-on-surface-variant mb-4">
        Saving regenerates this doctor's bookable slots for the next 60 days.
      </p>

      {isLoading ? (
        <div className="bg-surface-variant animate-pulse rounded-xl h-[200px]" />
      ) : (
        <>
          <div className="flex flex-col gap-2 mb-5">
            {WEEKDAYS.map((w) => (
              <div key={w.value} className="grid grid-cols-[24px_100px_1fr_1fr] gap-3 items-center">
                <input
                  type="checkbox"
                  className="w-4 h-4 rounded-sm border-outline text-primary accent-primary"
                  checked={rows[w.value].enabled}
                  onChange={(e) => setRows((prev) => ({ ...prev, [w.value]: { ...prev[w.value], enabled: e.target.checked } }))}
                />
                <span className="font-body-md text-sm text-on-surface">{w.label}</span>
                <input
                  type="time"
                  className="w-full bg-white border border-outline-variant rounded-md px-3 py-1.5 text-body-md focus:border-primary focus:outline-none disabled:bg-surface disabled:text-on-surface-variant"
                  disabled={!rows[w.value].enabled}
                  value={rows[w.value].startTime}
                  onChange={(e) => setRows((prev) => ({ ...prev, [w.value]: { ...prev[w.value], startTime: e.target.value } }))}
                />
                <input
                  type="time"
                  className="w-full bg-white border border-outline-variant rounded-md px-3 py-1.5 text-body-md focus:border-primary focus:outline-none disabled:bg-surface disabled:text-on-surface-variant"
                  disabled={!rows[w.value].enabled}
                  value={rows[w.value].endTime}
                  onChange={(e) => setRows((prev) => ({ ...prev, [w.value]: { ...prev[w.value], endTime: e.target.value } }))}
                />
              </div>
            ))}
          </div>

          <button
            className="w-full bg-primary text-on-primary font-label-sm text-[14px] px-5 py-2.5 rounded-md hover:bg-primary-container transition-colors disabled:opacity-50"
            disabled={!anyEnabled || saveMutation.isPending}
            onClick={() => saveMutation.mutate()}
          >
            {saveMutation.isPending ? "Saving..." : "Save Availability"}
          </button>
        </>
      )}
    </div>
  );
}
