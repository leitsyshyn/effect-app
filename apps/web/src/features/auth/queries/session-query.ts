import { queryOptions } from "@tanstack/react-query";
import { apiRuntime } from "@/lib/api/client";
import { getCurrentUser } from "@/lib/api/user";

export const sessionQueryOptions = queryOptions({
  queryKey: ["auth", "session"],
  queryFn: ({ signal }) => apiRuntime.runPromise(getCurrentUser, { signal }),
  retry: false,
});
