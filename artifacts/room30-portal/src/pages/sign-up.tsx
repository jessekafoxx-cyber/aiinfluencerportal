import { SignUp } from "@clerk/react";
import { AuthShell } from "@/components/auth-shell";
import { useSearch } from "wouter";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

export function SignUpPage() {
  // Pre-fill email if navigated from the "bought but can't sign in?" helper
  const search = useSearch();
  const params = new URLSearchParams(search);
  const prefillEmail = params.get("email") ?? undefined;

  return (
    <AuthShell mode="sign-up">
      <SignUp
        routing="path"
        path={`${basePath}/sign-up`}
        signInUrl={`${basePath}/sign-in`}
        fallbackRedirectUrl={`${basePath}/dashboard`}
        initialValues={prefillEmail ? { emailAddress: prefillEmail } : undefined}
        appearance={{
          elements: {
            rootBox: "w-full",
            cardBox: "w-full bg-transparent shadow-none !rounded-none",
            card: "!shadow-none !border-0 !bg-transparent !rounded-none p-0",
            footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
            logoBox: "hidden",
            logoImage: "hidden",
            headerTitle: "hidden",
            headerSubtitle: "hidden",
          },
        }}
      />
    </AuthShell>
  );
}
