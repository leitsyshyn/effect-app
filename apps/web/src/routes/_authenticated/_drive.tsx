import { createFileRoute } from "@tanstack/react-router";
import { DriveLayout } from "@/features/files/components/drive-layout";
import { validateDriveSearch } from "@/features/files/lib/drive-search";

export const Route = createFileRoute("/_authenticated/_drive")({
  validateSearch: validateDriveSearch,
  component: DriveLayout,
});
