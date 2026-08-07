import { Switch, Route, Router as WouterRouter } from "wouter";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/toaster";
import Page from "@/pages/sales";
import NotFound from "@/pages/not-found";

function Router() {
  return (
    <Switch>
      <Route path="/sales-a" component={Page} />
      <Route path="/" component={Page} />
      <Route component={Page} />
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
