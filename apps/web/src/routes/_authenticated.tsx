import { createFileRoute, redirect } from "@tanstack/react-router";
import { sessionQueryOptions } from "@/features/auth/queries/session-query";

export const Route = createFileRoute("/_authenticated")({
  beforeLoad: async ({ context }) => {
    const user = await context.queryClient.ensureQueryData(sessionQueryOptions);
    if (user === null) {
      throw redirect({ to: "/sign-in" });
    }
    return { user };
  },
});
