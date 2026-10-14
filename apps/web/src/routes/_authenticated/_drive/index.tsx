import { createFileRoute } from "@tanstack/react-router";
import { DrivePage } from "@/features/files/components/drive-page";
import { resolveListingOptions, toDriveSearch } from "@/features/files/lib/drive-search";
import { folderQueryOptions } from "@/features/files/queries/drive-queries";

export const Route = createFileRoute("/_authenticated/_drive/")({
  loaderDeps: ({ search }) => resolveListingOptions(search),
  loader: ({ context, deps }) => context.queryClient.prefetchQuery(folderQueryOptions(null, deps)),
  component: RootFolderPage,
});

function RootFolderPage() {
  const options = resolveListingOptions(Route.useSearch());
  const navigate = Route.useNavigate();
  return (
    <DrivePage
      folderId={null}
      options={options}
      onOptionsChange={(next) => void navigate({ search: toDriveSearch(next) })}
    />
  );
}
