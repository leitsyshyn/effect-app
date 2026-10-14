import { Link } from "@tanstack/react-router";
import { Fragment } from "react";
import type { DriveNode } from "@effect-app/domain/drive";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Skeleton } from "@/components/ui/skeleton";
import type { DropFolder, DropTargetProps } from "./use-node-drag";

const DROP_TARGET_CLASSES =
  "rounded-md px-1.5 py-0.5 data-[drag-active=true]:outline-1 data-[drag-active=true]:outline-dashed data-[drag-active=true]:outline-primary/60 data-[drop-target=true]:bg-primary/15 data-[drop-target=true]:text-foreground data-[drop-target=true]:outline-2 data-[drop-target=true]:outline-solid data-[drop-target=true]:outline-primary";

export function DriveBreadcrumb({
  path,
  isRoot,
  loading,
  dropTarget,
  dragActive,
}: {
  path: ReadonlyArray<DriveNode>;
  isRoot: boolean;
  loading: boolean;
  dropTarget: (folder: DropFolder) => DropTargetProps;
  dragActive: boolean;
}) {
  const ancestors = path.slice(0, -1);
  const current = path.at(-1);
  return (
    <Breadcrumb className="-ml-1.5">
      <BreadcrumbList className="text-base sm:gap-1">
        <BreadcrumbItem>
          {isRoot ? (
            <BreadcrumbPage className="px-1.5 font-semibold">My Drive</BreadcrumbPage>
          ) : (
            <BreadcrumbLink asChild>
              <Link
                to="/"
                search={true}
                className={DROP_TARGET_CLASSES}
                data-drag-active={dragActive}
                {...dropTarget({ id: null, name: "My Drive" })}
              >
                My Drive
              </Link>
            </BreadcrumbLink>
          )}
        </BreadcrumbItem>
        {ancestors.map((folder) => (
          <Fragment key={folder.id}>
            <BreadcrumbSeparator />
            <BreadcrumbItem className="min-w-0">
              <BreadcrumbLink asChild>
                <Link
                  to="/folders/$folderId"
                  params={{ folderId: folder.id }}
                  search={true}
                  className={`max-w-40 truncate ${DROP_TARGET_CLASSES}`}
                  title={folder.name}
                  data-drag-active={dragActive}
                  {...dropTarget({ id: folder.id, name: folder.name })}
                >
                  {folder.name}
                </Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
          </Fragment>
        ))}
        {!isRoot && (
          <>
            <BreadcrumbSeparator />
            <BreadcrumbItem className="min-w-0">
              {current === undefined ? (
                loading ? (
                  <Skeleton className="h-5 w-24" />
                ) : (
                  <BreadcrumbPage>Folder</BreadcrumbPage>
                )
              ) : (
                <BreadcrumbPage className="truncate px-1.5 font-semibold" title={current.name}>
                  {current.name}
                </BreadcrumbPage>
              )}
            </BreadcrumbItem>
          </>
        )}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
