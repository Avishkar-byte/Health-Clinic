"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch, useAuth } from "../providers";

export default function AdminDashboard() {
  const { token } = useAuth();
  const queryClient = useQueryClient();

  const { data: queueStats } = useQuery({
    queryKey: ["admin-queue-stats"],
    queryFn: () => apiFetch("/admin/notifications/stats", { token: token! }),
    refetchInterval: 5000,
  });

  const { data: deadLetters } = useQuery({
    queryKey: ["admin-dead-letters"],
    queryFn: () => apiFetch("/admin/notifications/dead", { token: token! }),
    refetchInterval: 5000,
  });

  const { data: health } = useQuery({
    queryKey: ["health"],
    queryFn: () => apiFetch("/health"),
    refetchInterval: 10000,
  });

  const retryMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/admin/notifications/${id}/retry`, { method: "POST", token: token! }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-dead-letters"] });
      queryClient.invalidateQueries({ queryKey: ["admin-queue-stats"] });
    }
  });

  return (
    <div className="flex flex-col w-full gap-6">
      
      {/* System Health */}
      <section className="flex flex-col gap-2">
        <h2 className="font-headline-md text-headline-md text-on-surface">System Health</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-surface-container-lowest border border-surface-variant rounded-xl p-4 flex flex-col justify-between">
            <span className="font-label-sm text-label-sm text-on-surface-variant uppercase mb-2">Overall Status</span>
            <div className="flex items-center gap-2">
              <div className={`w-2.5 h-2.5 rounded-full ${health?.status === "healthy" ? "bg-[#137333]" : "bg-error"}`} />
              <span className="font-body-md text-body-md font-medium text-on-surface capitalize">
                {health?.status || "Checking..."}
              </span>
            </div>
          </div>
          <div className="bg-surface-container-lowest border border-surface-variant rounded-xl p-4 flex flex-col justify-between">
            <span className="font-label-sm text-label-sm text-on-surface-variant uppercase mb-2">Database</span>
            <div className="flex items-center gap-2">
              <div className={`w-2.5 h-2.5 rounded-full ${health?.checks?.database === "ok" ? "bg-[#137333]" : "bg-outline"}`} />
              <span className="font-body-md text-body-md font-medium text-on-surface capitalize">
                {health?.checks?.database || "Unknown"}
              </span>
            </div>
          </div>
          <div className="bg-surface-container-lowest border border-surface-variant rounded-xl p-4 flex flex-col justify-between">
            <span className="font-label-sm text-label-sm text-on-surface-variant uppercase mb-2">Redis (BullMQ)</span>
            <div className="flex items-center gap-2">
              <div className={`w-2.5 h-2.5 rounded-full ${health?.checks?.redis === "ok" ? "bg-[#137333]" : health?.checks?.redis === "not_configured" ? "bg-[#F9AB00]" : "bg-outline"}`} />
              <span className="font-body-md text-body-md font-medium text-on-surface capitalize">
                {health?.checks?.redis === "not_configured" ? "Disabled" : health?.checks?.redis || "Unknown"}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Notification Queues */}
      <section className="flex flex-col gap-2">
        <h2 className="font-headline-md text-headline-md text-on-surface">Notification Queues</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-surface-container-lowest border border-surface-variant rounded-xl p-4 text-center">
            <div className="font-data-table text-display text-on-surface mb-1">{queueStats?.queued ?? "-"}</div>
            <div className="font-label-sm text-label-sm text-on-surface-variant uppercase">Queued</div>
          </div>
          <div className="bg-surface-container-lowest border border-surface-variant rounded-xl p-4 text-center">
            <div className="font-data-table text-display text-on-surface mb-1">{queueStats?.sent ?? "-"}</div>
            <div className="font-label-sm text-label-sm text-on-surface-variant uppercase">Sent</div>
          </div>
          <div className="bg-surface-container-lowest border border-surface-variant rounded-xl p-4 text-center">
            <div className="font-data-table text-display text-[#F9AB00] mb-1">{queueStats?.failed ?? "-"}</div>
            <div className="font-label-sm text-label-sm text-on-surface-variant uppercase">Retrying</div>
          </div>
          <div className={`bg-surface-container-lowest border ${queueStats?.dead > 0 ? "border-error bg-error-container/20" : "border-surface-variant"} rounded-xl p-4 text-center`}>
            <div className={`font-data-table text-display ${queueStats?.dead > 0 ? "text-error" : "text-on-surface"} mb-1`}>{queueStats?.dead ?? "-"}</div>
            <div className={`font-label-sm text-label-sm uppercase ${queueStats?.dead > 0 ? "text-error" : "text-on-surface-variant"}`}>Dead Letters</div>
          </div>
        </div>

        <h3 className="font-headline-sm text-[16px] font-semibold text-on-surface mb-2">Dead Letter Queue</h3>
        <div className="bg-surface-container-lowest border border-surface-variant rounded-xl overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[800px]">
            <thead>
              <tr className="bg-surface border-b border-surface-variant">
                <th className="py-2 px-4 font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider font-medium">Recipient</th>
                <th className="py-2 px-4 font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider font-medium">Template</th>
                <th className="py-2 px-4 font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider font-medium">Error</th>
                <th className="py-2 px-4 font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider font-medium">Time</th>
                <th className="py-2 px-4 font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider font-medium text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {!deadLetters || deadLetters.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-on-surface-variant font-body-md">
                    No dead letters.
                  </td>
                </tr>
              ) : (
                deadLetters.map((dl: any) => (
                  <tr key={dl.id} className="border-b border-surface-variant hover:bg-surface transition-colors">
                    <td className="py-3 px-4">
                      <div className="font-body-md text-on-surface font-medium">{dl.recipient?.fullName}</div>
                      <div className="font-body-md text-[12px] text-on-surface-variant">{dl.recipient?.email}</div>
                    </td>
                    <td className="py-3 px-4">
                      <code className="bg-surface-variant px-1.5 py-0.5 rounded text-[12px] font-data-sm text-on-surface">{dl.templateKey}</code>
                    </td>
                    <td className="py-3 px-4 text-error font-body-md text-[13px] max-w-[200px] truncate" title={dl.lastError}>
                      {dl.lastError}
                    </td>
                    <td className="py-3 px-4 font-data-sm text-[13px] text-on-surface">
                      {new Date(dl.createdAt).toLocaleString("en-GB")}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button 
                        className="font-label-sm text-[13px] text-primary hover:underline disabled:opacity-50"
                        onClick={() => retryMutation.mutate(dl.id)}
                        disabled={retryMutation.isPending}
                      >
                        Retry
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

    </div>
  );
}
