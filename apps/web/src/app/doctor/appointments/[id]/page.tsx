"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch, useAuth } from "../../../providers";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";

export default function ConsultPage() {
  const { token } = useAuth();
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [clinicalNotes, setClinicalNotes] = useState("");
  const [diagnosis, setDiagnosis] = useState("");
  
  // Basic prescription state
  const [prescriptionItems, setPrescriptionItems] = useState<any[]>([]);
  const [newDrug, setNewDrug] = useState("");
  const [newDose, setNewDose] = useState("");
  const [newFreq, setNewFreq] = useState("OD");
  const [newDuration, setNewDuration] = useState(5);

  const { data: preVisit, isLoading } = useQuery({
    queryKey: ["pre-visit", params.id],
    queryFn: () => apiFetch(`/appointments/${params.id}/pre-visit`, { token: token! }),
    enabled: !!token,
  });

  const submitNotesMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/appointments/${params.id}/notes`, {
        method: "POST",
        token: token!,
        body: JSON.stringify({
          clinicalNotes,
          diagnosis,
          prescriptionItems,
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["doctor-appointments"] });
      router.push("/doctor");
    },
    onError: (err: any) => {
      alert(err.title || "Failed to submit notes");
    }
  });

  const addPrescriptionItem = () => {
    if (!newDrug || !newDose) return;
    setPrescriptionItems([
      ...prescriptionItems,
      {
        drugName: newDrug,
        strength: "",
        doseText: newDose,
        frequency: newFreq,
        timing: "after_food",
        durationDays: newDuration,
        instructions: "",
      },
    ]);
    setNewDrug("");
    setNewDose("");
  };

  const removePrescriptionItem = (index: number) => {
    setPrescriptionItems(prescriptionItems.filter((_, i) => i !== index));
  };

  if (isLoading || !preVisit) {
    return <div className="bg-surface-variant animate-pulse rounded-xl h-[400px]" />;
  }

  const { summary, symptoms, patientName } = preVisit;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/doctor" className="inline-flex items-center text-primary font-body-md font-medium hover:underline">
          <span className="material-symbols-outlined text-[18px] mr-1">arrow_back</span>
          Back to Queue
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-6">
        
        {/* Left Column: Triage Summary (Read Only) */}
        <div className="flex flex-col gap-4">
          <div className="bg-surface-container-lowest border border-surface-variant rounded-xl p-5">
            <div className="flex justify-between items-baseline mb-4">
              <h2 className="font-headline-md text-headline-md text-on-surface">Patient Info</h2>
              {summary && (
                <span className={`inline-flex items-center px-2 py-1 rounded-[6px] font-label-sm text-label-sm uppercase ${
                  summary.urgency === "high" ? "bg-error-container text-on-error-container" : 
                  summary.urgency === "medium" ? "bg-[#FFF0B3] text-[#9A6700]" : 
                  "bg-[#E6F4EA] text-[#137333]"
                }`}>
                  {summary.urgency} urgency
                </span>
              )}
            </div>
            
            <h1 className="font-headline-lg text-headline-lg text-on-surface mb-4">{patientName}</h1>

            {summary?.status === "ready" ? (
              <>
                <div className="mb-4">
                  <div className="font-label-sm text-label-sm text-on-surface-variant uppercase mb-2">Chief Complaint</div>
                  <div className="font-body-lg text-on-surface font-medium">{summary.chiefComplaint}</div>
                </div>

                <div className="mb-4">
                  <div className="font-label-sm text-label-sm text-on-surface-variant uppercase mb-2">Suggested Questions</div>
                  <ul className="list-disc pl-4 m-0 font-body-md text-on-surface flex flex-col gap-1">
                    {summary.suggestedQuestions.map((q: string, i: number) => (
                      <li key={i}>{q}</li>
                    ))}
                  </ul>
                </div>

                {summary.redFlags && summary.redFlags.length > 0 && (
                  <div className="p-3 bg-error-container/20 border border-error/30 rounded-[6px] text-error font-body-md">
                    <div className="font-label-sm text-label-sm uppercase mb-2">Red Flags</div>
                    <ul className="list-disc pl-4 m-0">
                      {summary.redFlags.map((flag: string, i: number) => (
                        <li key={i}>{flag}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            ) : summary?.status === "pending" ? (
              <div className="p-4 bg-surface rounded-xl border border-surface-variant">
                <p className="font-label-sm text-label-sm text-on-surface-variant uppercase mb-2 flex items-center gap-1">
                  <span className="material-symbols-outlined text-[16px]">hourglass_empty</span> Analyzing symptoms...
                </p>
                <p className="font-body-md text-on-surface-variant mb-4 text-[13px]">
                  The AI triage summary is still being generated. Raw patient intake data is shown below in the meantime.
                </p>
                <div className="font-label-sm text-label-sm text-on-surface-variant uppercase mb-1">Symptoms ({symptoms.durationDays} days)</div>
                <p className="font-body-md text-on-surface mb-3">{symptoms.rawSymptoms}</p>

                <div className="font-label-sm text-label-sm text-on-surface-variant uppercase mb-1">Current Meds</div>
                <p className="font-body-md text-on-surface">{symptoms.currentMedications.join(", ") || "None"}</p>
              </div>
            ) : (
              <div className="p-4 bg-surface rounded-xl border border-surface-variant">
                <p className="font-label-sm text-label-sm text-[#F9AB00] uppercase mb-2 flex items-center gap-1">
                  <span className="material-symbols-outlined text-[16px]">warning</span> AI Triage Unavailable
                </p>
                <p className="font-body-md text-on-surface-variant mb-4 text-[13px]">
                  The AI triage summary could not be generated for this visit. Displaying raw patient intake data.
                </p>
                <div className="font-label-sm text-label-sm text-on-surface-variant uppercase mb-1">Symptoms ({symptoms.durationDays} days)</div>
                <p className="font-body-md text-on-surface mb-3">{symptoms.rawSymptoms}</p>

                <div className="font-label-sm text-label-sm text-on-surface-variant uppercase mb-1">Current Meds</div>
                <p className="font-body-md text-on-surface">{symptoms.currentMedications.join(", ") || "None"}</p>
              </div>
            )}
            
            {/* Raw symptoms accordion (always available) */}
            {summary?.status === "ready" && (
              <details className="mt-4 font-body-md text-[13px] group">
                <summary className="cursor-pointer text-on-surface-variant hover:text-on-surface font-medium transition-colors select-none">
                  View raw intake data
                </summary>
                <div className="mt-2 p-3 bg-surface rounded-[6px] text-on-surface">
                  <p>{symptoms.rawSymptoms}</p>
                </div>
              </details>
            )}
          </div>
        </div>

        {/* Right Column: Consult Workspace */}
        <div className="bg-surface-container-lowest border border-surface-variant rounded-xl p-6 h-fit">
          <h2 className="font-headline-lg text-headline-lg text-on-surface mb-6">Consultation Workspace</h2>
          
          <form onSubmit={(e) => { e.preventDefault(); submitNotesMutation.mutate(); }}>
            <div className="mb-6">
              <label className="font-label-sm text-label-sm text-on-surface-variant uppercase mb-2 block">Clinical Notes</label>
              <textarea
                className="w-full bg-white border border-outline-variant rounded-md px-3 py-2 text-body-md focus:border-primary focus:outline-none min-h-[120px] resize-y"
                required
                value={clinicalNotes}
                onChange={(e) => setClinicalNotes(e.target.value)}
                placeholder="Subjective, Objective, Assessment, Plan..."
              />
            </div>

            <div className="mb-6">
              <label className="font-label-sm text-label-sm text-on-surface-variant uppercase mb-2 block">Primary Diagnosis</label>
              <input
                type="text"
                className="w-full bg-white border border-outline-variant rounded-md px-3 py-2 text-body-md focus:border-primary focus:outline-none"
                required
                value={diagnosis}
                onChange={(e) => setDiagnosis(e.target.value)}
                placeholder="e.g. Acute Bronchitis"
              />
            </div>

            <div className="mb-6">
              <div className="font-label-sm text-label-sm text-on-surface-variant uppercase mb-3 block">Prescription</div>
              
              {/* Rx Items */}
              {prescriptionItems.length > 0 && (
                <div className="flex flex-col gap-3 mb-4">
                  {prescriptionItems.map((item, i) => (
                    <div key={i} className="flex justify-between items-center p-3 bg-surface rounded-[6px] border border-surface-variant">
                      <div>
                        <div className="font-body-md font-medium text-on-surface">{item.drugName}</div>
                        <div className="font-body-md text-[13px] text-on-surface-variant mt-0.5">
                          {item.doseText} • {item.frequency} for {item.durationDays} days
                        </div>
                      </div>
                      <button 
                        type="button" 
                        className="font-label-sm text-[12px] text-error hover:underline px-2 py-1" 
                        onClick={() => removePrescriptionItem(i)}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Add Rx Form */}
              <div className="grid grid-cols-1 sm:grid-cols-[2fr_1fr_1fr_1fr_auto] gap-2 items-end">
                <div>
                  <label className="font-label-sm text-[11px] text-on-surface-variant mb-1 block">Drug</label>
                  <input type="text" className="w-full bg-white border border-outline-variant rounded-md px-2 py-1.5 text-body-md text-[13px] focus:border-primary focus:outline-none" placeholder="Name" value={newDrug} onChange={(e) => setNewDrug(e.target.value)} />
                </div>
                <div>
                  <label className="font-label-sm text-[11px] text-on-surface-variant mb-1 block">Dose</label>
                  <input type="text" className="w-full bg-white border border-outline-variant rounded-md px-2 py-1.5 text-body-md text-[13px] focus:border-primary focus:outline-none" placeholder="e.g. 1 tab" value={newDose} onChange={(e) => setNewDose(e.target.value)} />
                </div>
                <div>
                  <label className="font-label-sm text-[11px] text-on-surface-variant mb-1 block">Freq</label>
                  <select className="w-full bg-white border border-outline-variant rounded-md px-2 py-1.5 text-body-md text-[13px] focus:border-primary focus:outline-none" value={newFreq} onChange={(e) => setNewFreq(e.target.value)}>
                    <option value="OD">OD (1/day)</option>
                    <option value="BD">BD (2/day)</option>
                    <option value="TDS">TDS (3/day)</option>
                    <option value="SOS">SOS (As needed)</option>
                  </select>
                </div>
                <div>
                  <label className="font-label-sm text-[11px] text-on-surface-variant mb-1 block">Days</label>
                  <input type="number" className="w-full bg-white border border-outline-variant rounded-md px-2 py-1.5 text-body-md text-[13px] focus:border-primary focus:outline-none" min="1" value={newDuration} onChange={(e) => setNewDuration(parseInt(e.target.value))} />
                </div>
                <button 
                  type="button" 
                  className="bg-surface-variant text-on-surface hover:bg-outline-variant font-label-sm text-[13px] px-3 py-1.5 rounded-md transition-colors" 
                  onClick={addPrescriptionItem}
                >
                  Add
                </button>
              </div>
            </div>

            <div className="flex justify-end pt-4 border-t border-surface-variant">
              <button 
                type="submit" 
                className="bg-primary text-on-primary font-label-sm text-[14px] px-5 py-2.5 rounded-md hover:bg-primary-container transition-colors disabled:opacity-50" 
                disabled={submitNotesMutation.isPending || (!clinicalNotes || !diagnosis)}
              >
                {submitNotesMutation.isPending ? "Submitting..." : "Complete Visit"}
              </button>
            </div>
          </form>
        </div>

      </div>
    </div>
  );
}
