import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { AdminLayout } from "@/components/admin-layout";
import { PORTAL_PAGE_CLASS } from "@/components/portal-page";
import { useState } from "react";
import { Send, CheckCircle2, Clock, Mail } from "lucide-react";

export function AdminInvites() {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");

  const { data: invites, isLoading } = useQuery({
    queryKey: ["admin-invites"],
    queryFn: api.admin.getInvites,
  });

  const createMutation = useMutation({
    mutationFn: (email: string) => api.admin.createInvite(email),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-invites"] });
      setEmail("");
    },
  });

  return (
    <AdminLayout>
      <div className={PORTAL_PAGE_CLASS}>
        <div className="mb-10">
          <p className="text-[12px] text-[#C9A44C] font-bold uppercase tracking-[0.15em] mb-2">
            Admin Panel
          </p>
          <h1
            className="text-[28px] md:text-[36px] font-bold uppercase tracking-[0.01em] text-white leading-tight"
            style={{ fontFamily: "var(--app-font-display)" }}
          >
            Invite Management
          </h1>
        </div>

        <div className="bg-[#0f0f0f] border border-white/[0.06] rounded-xl p-6 mb-8">
          <h3
            className="text-[14px] font-bold uppercase text-white mb-4"
            style={{ fontFamily: "var(--app-font-display)" }}
          >
            Send New Invite
          </h3>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (email.trim()) createMutation.mutate(email.trim());
            }}
            className="flex gap-3"
          >
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Enter email address..."
              className="flex-1 bg-white/[0.04] border border-white/[0.1] rounded-lg px-4 py-3 text-[13px] text-white placeholder:text-white/45 focus:outline-none focus:border-[#C9A44C]/50 transition-colors"
            />
            <button
              type="submit"
              disabled={createMutation.isPending || !email.trim()}
              className="flex items-center gap-2 bg-[#C9A44C] hover:bg-[#B8902F] text-white text-[12px] font-bold uppercase tracking-wider px-6 py-3 rounded-lg transition-colors disabled:opacity-50"
            >
              <Send className="w-4 h-4" />
              {createMutation.isPending ? "Sending..." : "Send Invite"}
            </button>
          </form>
          {createMutation.isError && (
            <p className="text-[12px] text-amber-400 mt-2">
              {(createMutation.error as Error).message}
            </p>
          )}
          {createMutation.isSuccess && (
            <p className="text-[12px] text-green-400 mt-2">Invite created successfully!</p>
          )}
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-2 border-[#C9A44C] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="bg-[#0f0f0f] border border-white/[0.06] rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-white/[0.06]">
                    <th className="text-left px-6 py-3 text-[11px] text-white/65 uppercase tracking-wider font-bold">
                      Email
                    </th>
                    <th className="text-left px-6 py-3 text-[11px] text-white/65 uppercase tracking-wider font-bold">
                      Status
                    </th>
                    <th className="text-left px-6 py-3 text-[11px] text-white/65 uppercase tracking-wider font-bold">
                      Created
                    </th>
                    <th className="text-left px-6 py-3 text-[11px] text-white/65 uppercase tracking-wider font-bold">
                      Claimed
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04]">
                  {invites?.map((inv: any) => (
                    <tr key={inv.id} className="hover:bg-white/[0.02]">
                      <td className="px-6 py-3">
                        <div className="flex items-center gap-2">
                          <Mail className="w-4 h-4 text-white/45" />
                          <span className="text-[13px] text-white/70">{inv.email}</span>
                        </div>
                      </td>
                      <td className="px-6 py-3">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                            inv.status === "claimed"
                              ? "bg-green-500/15 text-green-400"
                              : inv.status === "sent"
                                ? "bg-yellow-500/15 text-yellow-400"
                                : "bg-white/[0.06] text-white/50"
                          }`}
                        >
                          {inv.status === "claimed" ? (
                            <CheckCircle2 className="w-3 h-3" />
                          ) : (
                            <Clock className="w-3 h-3" />
                          )}
                          {inv.status}
                        </span>
                      </td>
                      <td className="px-6 py-3 text-[12px] text-white/65">
                        {new Date(inv.createdAt).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-3 text-[12px] text-white/65">
                        {inv.claimedAt ? new Date(inv.claimedAt).toLocaleDateString() : "—"}
                      </td>
                    </tr>
                  ))}
                  {(!invites || invites.length === 0) && (
                    <tr>
                      <td colSpan={4} className="px-6 py-10 text-center text-[13px] text-white/55">
                        No invites sent yet
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
