import { SignIn } from "@clerk/react";
import { AuthShell } from "@/components/auth-shell";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

export function SignInPage() {
  return (
    <AuthShell mode="sign-in">
      <SignIn
        routing="path"
        path={`${basePath}/sign-in`}
        signUpUrl={`${basePath}/sign-up`}
        forceRedirectUrl={`${basePath}/dashboard`}
        appearance={{
          elements: {
            // Flush the card into the auth-shell right panel
            rootBox: "w-full",
            cardBox: "w-full bg-transparent shadow-none !rounded-none",
            card: "!shadow-none !border-0 !bg-transparent !rounded-none p-0",
            footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
            // Auth-shell provides all branding/copy — hide Clerk's header
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
