import { useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

// The old landing page only showed the (empty) Instagram Highlight Covers
// library, so members clicking "Done For You Pack" landed on a blank page.
// It now forwards straight to the first real library in the pack.
export default function DoneForYouPack() {
  const [, setLocation] = useLocation();
  const { data: me, isLoading } = useQuery({ queryKey: ["me"], queryFn: api.getMe });
  const paid = !!(me?.user as any)?.doneForYouPackPaid;
  const isAdmin = me?.user?.role === "admin";
  const hasAccess = paid || isAdmin;

  useEffect(() => {
    if (isLoading) return;
    setLocation(hasAccess ? "/done-for-you-pack/100-ai-influencers" : "/dashboard", {
      replace: true,
    });
  }, [isLoading, hasAccess, setLocation]);

  return null;
}
