import { createRouter } from "@tanstack/react-router";
import { revalidateSessionOnUnauthorized } from "@/features/auth/lib/revalidate-session";
import { queryClient } from "@/lib/query-client";
import { routeTree } from "@/routeTree.gen";

export const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: "intent",
  defaultPreloadStaleTime: 0,
  scrollRestoration: true,
});

revalidateSessionOnUnauthorized(queryClient, router);

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
