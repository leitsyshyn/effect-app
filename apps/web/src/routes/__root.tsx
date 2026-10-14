import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, Link, Outlet, useMatch } from "@tanstack/react-router";
import { FileQuestionIcon } from "lucide-react";
import { Brand } from "@/components/brand";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { UserMenu } from "@/features/auth/components/user-menu";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: RootLayout,
  notFoundComponent: () => (
    <EmptyState
      icon={FileQuestionIcon}
      title="Page not found"
      description="The link may be broken, or the page may have moved."
      action={
        <Button asChild variant="outline">
          <Link to="/">Go to My Drive</Link>
        </Button>
      }
      className="min-h-[60svh]"
    />
  ),
});

function RootLayout() {
  const user = useMatch({
    from: "/_authenticated",
    shouldThrow: false,
    select: (match) => match.context.user,
  });
  const isGuest = useMatch({ from: "/_guest", shouldThrow: false }) !== undefined;
  return (
    <div className="min-h-svh bg-background text-foreground">
      {!isGuest && (
        <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <nav
            aria-label="Main navigation"
            className="flex h-14 items-center justify-between gap-4 px-4 sm:px-6"
          >
            <Link
              to="/"
              search={true}
              className="rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <Brand />
            </Link>
            {user && <UserMenu name={user.name} email={user.email} />}
          </nav>
        </header>
      )}
      <div className="flex">
        <main
          className={
            isGuest
              ? "flex-1"
              : "min-w-0 flex-1 px-4 pt-5 pb-[calc(var(--upload-panel-height,0px)+1.5rem)] sm:px-6"
          }
        >
          <Outlet />
        </main>
      </div>
      <Toaster
        position="bottom-right"
        offset={{ bottom: "calc(var(--upload-panel-height, 16px) + 8px)" }}
        mobileOffset={{ bottom: "calc(var(--upload-panel-height, 8px) + 8px)" }}
      />
    </div>
  );
}
