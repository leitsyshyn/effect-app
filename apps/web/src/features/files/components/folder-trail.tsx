import { useNavigate } from "@tanstack/react-router";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { DriveNode } from "@effect-app/domain/drive";
import { IconButton } from "@/components/icon-button";
import type { DropFolder } from "./use-node-drag";

type Trail = ReadonlyArray<Pick<DriveNode, "id" | "name">>;

const TrailContext = createContext<{
  readonly trail: Trail;
  readonly setTrail: (update: (current: Trail) => Trail) => void;
}>({ trail: [], setTrail: () => {} });

export function FolderTrailProvider({ children }: { children: ReactNode }) {
  const [trail, setTrail] = useState<Trail>([]);
  return <TrailContext value={{ trail, setTrail }}>{children}</TrailContext>;
}

const isPrefix = (path: Trail, of: Trail) =>
  path.length <= of.length && path.every((folder, index) => folder.id === of[index]?.id);

const ROOT: DropFolder = { id: null, name: "My Drive" };

export function FolderTrailButtons({ path }: { path: Trail | undefined }) {
  const navigate = useNavigate();
  const { trail, setTrail } = useContext(TrailContext);
  useEffect(() => {
    if (path !== undefined) setTrail((current) => (isPrefix(path, current) ? current : path));
  }, [path, setTrail]);

  const back: DropFolder | undefined =
    path === undefined || path.length === 0 ? undefined : (path.at(-2) ?? ROOT);
  const forward = path !== undefined && isPrefix(path, trail) ? trail[path.length] : undefined;
  const open = (folder: DropFolder) =>
    void (folder.id === null
      ? navigate({ to: "/", search: true })
      : navigate({ to: "/folders/$folderId", params: { folderId: folder.id }, search: true }));

  return (
    <div className="flex shrink-0 items-center">
      <IconButton
        label={back === undefined ? "Back" : `Back to ${back.name}`}
        variant="outline"
        className="rounded-r-none"
        disabled={back === undefined}
        onClick={() => back !== undefined && open(back)}
      >
        <ChevronLeftIcon aria-hidden />
      </IconButton>
      <IconButton
        label={forward === undefined ? "Forward" : `Forward to ${forward.name}`}
        variant="outline"
        className="-ml-px rounded-l-none"
        disabled={forward === undefined}
        onClick={() => forward !== undefined && open(forward)}
      >
        <ChevronRightIcon aria-hidden />
      </IconButton>
    </div>
  );
}
