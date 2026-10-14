import { createFileRoute, Link } from "@tanstack/react-router";
import { Link2OffIcon } from "lucide-react";
import { Option, Schema } from "effect";
import { NodeId } from "@effect-app/domain/drive";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { DrivePage } from "@/features/files/components/drive-page";
import { resolveListingOptions, toDriveSearch } from "@/features/files/lib/drive-search";
import { folderQueryOptions } from "@/features/files/queries/drive-queries";

const decodeNodeId = Schema.decodeUnknownOption(NodeId);

export const Route = createFileRoute("/_authenticated/_drive/folders/$folderId")({
  loaderDeps: ({ search }) => resolveListingOptions(search),
  loader: ({ context, params, deps }) =>
    Option.match(decodeNodeId(params.folderId), {
      onNone: () => undefined,
      onSome: (folderId) => context.queryClient.prefetchQuery(folderQueryOptions(folderId, deps)),
    }),
  component: FolderPage,
});

function FolderPage() {
  const { folderId } = Route.useParams();
  const options = resolveListingOptions(Route.useSearch());
  const navigate = Route.useNavigate();
  return Option.match(decodeNodeId(folderId), {
    onNone: () => (
      <EmptyState
        alert
        icon={Link2OffIcon}
        title="This isn't a valid folder link"
        description="Check the link, or find the folder in My Drive."
        action={
          <Button asChild variant="outline">
            <Link to="/">Go to My Drive</Link>
          </Button>
        }
        className="min-h-[60svh]"
      />
    ),
    onSome: (id) => (
      <DrivePage
        key={id}
        folderId={id}
        options={options}
        onOptionsChange={(next) => void navigate({ search: toDriveSearch(next) })}
      />
    ),
  });
}
