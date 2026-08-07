import { Switch, Route, Router as WouterRouter } from "wouter";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/toaster";
import Page from "@/pages/upsell-1";
import NotFound from "@/pages/not-found";

function Router() {
  return (
    <Switch>
      <Route path="/upsell-1" component={Page} />
      <Route path="/" component={Page} />
      <Route component={NotFound} />
    </Switch>
  );
}

export default function App() {
  return (
    
      <TooltipProvider>
        <Toaster />
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
      </TooltipProvider>
    
  );
}
