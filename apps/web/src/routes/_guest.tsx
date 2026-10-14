import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { Brand } from "@/components/brand";
import { sessionQueryOptions } from "@/features/auth/queries/session-query";

export const Route = createFileRoute("/_guest")({
  beforeLoad: async ({ context }) => {
    const user = await context.queryClient.ensureQueryData(sessionQueryOptions);
    if (user !== null) {
      throw redirect({ to: "/" });
    }
  },
  component: GuestLayout,
});

function GuestLayout() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted/40 p-4">
      <Brand className="text-lg" />
      <Outlet />
    </div>
  );
}
