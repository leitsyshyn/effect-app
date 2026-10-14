import { useQueryClient } from "@tanstack/react-query";
import { Outlet, useRouter } from "@tanstack/react-router";
import { useCallback } from "react";
import { revalidateSession } from "@/features/auth/lib/revalidate-session";
import { useDriveChangeStream } from "@/features/files/queries/drive-changes";
import { ConflictDialog } from "./conflict-dialog";
import { FolderTrailProvider } from "./folder-trail";
import { UploadPanel } from "./upload-panel";
import { UploadProvider } from "./upload-provider";

export function DriveLayout() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const onDisconnected = useCallback(
    () => void revalidateSession(queryClient, router),
    [queryClient, router],
  );
  useDriveChangeStream(onDisconnected);

  return (
    <UploadProvider>
      <FolderTrailProvider>
        <Outlet />
      </FolderTrailProvider>
      <UploadPanel />
      <ConflictDialog />
    </UploadProvider>
  );
}
