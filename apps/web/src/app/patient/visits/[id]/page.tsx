"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch, useAuth } from "../../../providers";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";

export default function PostVisitSummaryPage() {
  const { token } = useAuth();
  const params = useParams();
  const router = useRouter();
  
  const { data: visit, isLoading, error } = useQuery({
    queryKey: ["post-visit", params.id],
    queryFn: () => apiFetch(`/appointments/${params.id}/post-visit`, { token: token! }),
    enabled: !!token,
    retry: false,
  });

  if (error) {
    return (
      <div className="bg-surface-container-lowest border border-surface-variant rounded-xl p-6">
        <p className="text-error font-body-md mb-4">Failed to load visit summary.</p>
        <button onClick={() => router.push("/patient")} className="text-on-surface hover:bg-surface-variant font-label-sm text-[14px] px-4 py-2 rounded-md transition-colors inline-flex items-center">
          <span className="material-symbols-outlined text-[18px] mr-1">arrow_back</span>
          Back to Dashboard
        </button>
      </div>
    );
  }

  if (isLoading || !visit) {
    return (
      <div className="flex flex-col gap-6">
        <div className="bg-surface-variant animate-pulse rounded-xl h-[100px]" />
        <div className="bg-surface-variant animate-pulse rounded-xl h-[300px]" />
      </div>
    );
  }

  const { summary, doctorName, specialisation, prescription, visitNote } = visit;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/patient" className="inline-flex items-center text-primary font-body-md font-medium hover:underline">
          <span className="material-symbols-outlined text-[18px] mr-1">arrow_back</span>
          Back to Dashboard
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-6">
        {/* Main Column */}
        <div className="flex flex-col gap-6">
          
          <div className="bg-surface-container-lowest border border-surface-variant rounded-xl p-6">
            <div className="mb-6">
              <div className="font-label-sm text-label-sm text-on-surface-variant uppercase mb-2">Visit Summary</div>
              <h1 className="font-headline-lg text-headline-lg text-on-surface mb-1">{doctorName}</h1>
              <p className="text-on-surface-variant font-body-md text-[14px]">{specialisation}</p>
            </div>

            {summary?.status === "ready" ? (
              <div className="font-body-lg leading-relaxed text-on-surface bg-primary-container/20 p-5 rounded-xl border border-primary-container/30">
                {summary.patientSummary}
              </div>
            ) : (
              <div className="bg-surface p-5 rounded-xl border border-surface-variant">
                <p className="font-label-sm text-label-sm text-[#F9AB00] uppercase mb-3 flex items-center gap-1">
                  <span className="material-symbols-outlined text-[16px]">warning</span> Degraded Mode
                </p>
                <p className="font-body-md text-[14px] text-on-surface-variant mb-5">
                  The AI-generated plain language summary is currently unavailable. Displaying raw clinical notes.
                </p>
                <div className="font-body-md text-[14px] text-on-surface whitespace-pre-wrap">
                  <strong>Diagnosis:</strong> {visitNote?.diagnosis}<br/><br/>
                  {visitNote?.clinicalNotes}
                </div>
              </div>
            )}
          </div>

          {/* Follow Up Steps (if AI ready) */}
          {summary?.status === "ready" && summary.followUpSteps && summary.followUpSteps.length > 0 && (
            <div className="bg-surface-container-lowest border border-surface-variant rounded-xl p-6">
              <h2 className="font-headline-md text-headline-md text-on-surface mb-4">Next Steps</h2>
              <ul className="list-disc pl-5 m-0 flex flex-col gap-2 font-body-md text-[15px] text-on-surface">
                {summary.followUpSteps.map((step: string, i: number) => (
                  <li key={i}>{step}</li>
                ))}
              </ul>
            </div>
          )}

        </div>

        {/* Right Column */}
        <div className="flex flex-col gap-6">
          
          {/* Prescription */}
          <div className="bg-surface-container-lowest border border-surface-variant rounded-xl p-5">
            <h2 className="font-headline-md text-headline-md text-on-surface mb-4">Prescription</h2>
            
            {!prescription?.items || prescription.items.length === 0 ? (
              <p className="font-body-md text-[14px] text-on-surface-variant">No medication prescribed.</p>
            ) : (
              <div className="flex flex-col gap-4">
                {prescription.items.map((item: any, i: number) => (
                  <div key={i} className={`pb-4 ${i !== prescription.items.length - 1 ? "border-b border-surface-variant" : ""}`}>
                    <div className="font-body-md font-medium text-[15px] text-on-surface mb-1">
                      {item.drugName} {item.strength && <span className="text-on-surface-variant font-normal">{item.strength}</span>}
                    </div>
                    <div className="font-body-md text-[14px] text-on-surface mb-1">
                      {item.doseText} <span className="mx-1">•</span> {item.frequency}
                    </div>
                    <div className="font-body-md text-[13px] text-on-surface-variant">
                      {item.timing.replace('_', ' ')} for {item.durationDays} days
                      {item.instructions && <div className="mt-1 italic">"{item.instructions}"</div>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {visitNote?.followUpDate && (
            <div className="bg-primary-container/20 border border-primary p-5 rounded-xl">
              <div className="font-label-sm text-label-sm text-primary uppercase mb-2">Recommended Follow-up</div>
              <div className="font-headline-md text-[16px] text-on-surface">
                {new Date(visitNote.followUpDate).toLocaleDateString("en-GB", { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
