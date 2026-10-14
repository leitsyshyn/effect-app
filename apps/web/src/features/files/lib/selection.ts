export interface Selection<Id> {
  readonly ids: ReadonlySet<Id>;
  readonly anchor: Id | undefined;
}

export type SelectGesture = "replace" | "toggle" | "range";

export const emptySelection = <Id>(): Selection<Id> => ({ ids: new Set(), anchor: undefined });

export const gestureOf = (event: {
  readonly shiftKey: boolean;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
}): SelectGesture =>
  event.shiftKey ? "range" : event.metaKey || event.ctrlKey ? "toggle" : "replace";

export const select = <Id>(
  selection: Selection<Id>,
  id: Id,
  order: ReadonlyArray<Id>,
  gesture: SelectGesture,
): Selection<Id> => {
  switch (gesture) {
    case "replace":
      return { ids: new Set([id]), anchor: id };
    case "toggle": {
      const ids = new Set(selection.ids);
      if (ids.has(id)) ids.delete(id);
      else ids.add(id);
      return { ids, anchor: id };
    }
    case "range": {
      const anchor = selection.anchor;
      const from = anchor === undefined ? -1 : order.indexOf(anchor);
      const to = order.indexOf(id);
      if (from === -1 || to === -1) return { ids: new Set([id]), anchor: id };
      const [start, end] = from <= to ? [from, to] : [to, from];
      return { ids: new Set(order.slice(start, end + 1)), anchor };
    }
  }
};

export const selectAll = <Id>(order: ReadonlyArray<Id>, anchor?: Id): Selection<Id> => ({
  ids: new Set(order),
  anchor: anchor ?? order[0],
});

export const prune = <Id>(selection: Selection<Id>, order: ReadonlyArray<Id>): Selection<Id> => {
  const shown = new Set(order);
  const ids = new Set(Array.from(selection.ids).filter((id) => shown.has(id)));
  const anchor =
    selection.anchor !== undefined && shown.has(selection.anchor) ? selection.anchor : undefined;
  return ids.size === selection.ids.size && anchor === selection.anchor
    ? selection
    : { ids, anchor };
};
