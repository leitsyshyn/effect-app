import type { QueryClient } from "@tanstack/react-query";
import type { AnyRouter } from "@tanstack/react-router";
import { sessionQueryOptions } from "@/features/auth/queries/session-query";
import { isUnauthorized } from "@/lib/api/errors";

let pending: Promise<void> | undefined;

export const revalidateSession = (queryClient: QueryClient, router: AnyRouter): Promise<void> => {
  pending ??= (async () => {
    try {
      const user = await queryClient.fetchQuery({ ...sessionQueryOptions, staleTime: 0 });
      if (user !== null) return;
      queryClient.clear();
      queryClient.setQueryData(sessionQueryOptions.queryKey, null);
      await router.invalidate();
    } catch {
    } finally {
      pending = undefined;
    }
  })();
  return pending;
};

export const revalidateSessionOnUnauthorized = (queryClient: QueryClient, router: AnyRouter) => {
  const onError = (error: unknown) => {
    if (isUnauthorized(error)) void revalidateSession(queryClient, router);
  };
  queryClient.getQueryCache().subscribe((event) => {
    if (event.type === "updated" && event.action.type === "error") onError(event.action.error);
  });
  queryClient.getMutationCache().subscribe((event) => {
    if (event.type === "updated" && event.action.type === "error") onError(event.action.error);
  });
};
