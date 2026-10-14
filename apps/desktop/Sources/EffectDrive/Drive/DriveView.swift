import AppKit
import SwiftUI

private struct MoveRequest: Identifiable {
    let id = UUID()
    let items: [DriveItem]
}

struct DriveView: View {
    @Bindable var model: DriveViewModel
    let sync: SyncViewModel
    let showSync: () -> Void
    @Environment(\.undoManager) private var undoManager
    @State private var showPreview = false
    @State private var isDropTargeted = false
    @State private var moveRequest: MoveRequest?
    @State private var pendingDelete: [DriveItem] = []

    var body: some View {
        VStack(spacing: 0) {
            Breadcrumb(path: model.path, navigate: model.navigate(to:), drop: dropMove)
            Divider()
            content
            Divider()
            StatusBar(model: model, sync: SyncSummary(connection: sync.connection, status: sync.status), showSync: showSync)
        }
        .navigationTitle(model.folderName)
        .toolbar { toolbar }
        .searchable(text: $model.nameQuery, placement: .toolbar, prompt: "Filter by name")
        .background { ToolbarSearchWidth() }
        .focusedSceneValue(\.driveActions, actions)
        .inspector(isPresented: $showPreview) {
            PreviewPane(model: model, download: download, open: model.open)
                .inspectorColumnWidth(min: 300, ideal: 416, max: 600)
        }
        .sheet(item: $moveRequest) { request in
            MoveSheet(items: request.items, startIn: model.folderId, load: model.listing(of:)) { parentId, name in
                Task { await model.move(request.items, to: parentId, named: name, undoManager: undoManager) }
            }
        }
        .confirmationDialog(deleteTitle, isPresented: isPresent($pendingDelete), titleVisibility: .visible) {
            Button("Delete", role: .destructive) {
                let items = pendingDelete
                Task { await model.delete(items) }
            }
        } message: {
            Text(deleteMessage)
        }
        .background { UploadConflictDialog(model: model) }
        .alert(
            model.alert?.title ?? "",
            isPresented: isPresent($model.alert),
            presenting: model.alert
        ) { _ in
            Button("OK") {}
        } message: { alert in
            Text(alert.message)
        }
    }

    @ViewBuilder
    private var content: some View {
        if let error = model.loadError {
            ContentUnavailableView {
                Label("Couldn't load this folder", systemImage: "exclamationmark.triangle")
            } description: {
                Text(error.message)
            } actions: {
                Button("Try again") { Task { await model.reload() } }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            Group {
                if model.rows.isEmpty, !model.isLoading, model.editing != .newFolder {
                    emptyState
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .background(.background)
                        .contentShape(Rectangle())
                        .contextMenu { emptySpaceMenu }
                } else {
                    table
                }
            }
            .overlay {
                if isDropTargeted {
                    ZStack {
                        RoundedRectangle(cornerRadius: 8)
                            .strokeBorder(Color.accentColor, lineWidth: 3)
                        Label("Drop files to upload to \(model.folderName)", systemImage: "square.and.arrow.up")
                            .padding(.horizontal, Layout.inset)
                            .padding(.vertical, Layout.spacing)
                            .background(.regularMaterial, in: Capsule())
                    }
                    .padding(4)
                    .allowsHitTesting(false)
                }
            }
            .dropDestination(for: URL.self) { urls, _ in
                model.upload(urls)
            } isTargeted: { isDropTargeted = $0 }
        }
    }

    private var sortOrder: Binding<[ListingSort]> {
        Binding(get: { [model.sort] }, set: { if let sort = $0.first { model.sort = sort } })
    }

    private func isVisible(_ column: DriveColumn) -> Bool {
        model.columns.isVisible(column, besidePreview: showPreview)
    }

    private var table: some View {
        let badges = SyncBadges(pending: sync.pending.map(\.path), attention: sync.issues.map(\.path))
        let folderPath = model.path.map(\.name)
        return ScrollViewReader { proxy in
            Table(of: DriveItem.self, selection: $model.selection, sortOrder: sortOrder) {
                TableColumn(DriveColumn.name.title, sortUsing: ListingSort(.name)) { item in
                    nameCell(item, badge: badges.badge(for: folderPath + [item.name]))
                }
                .width(min: 180, ideal: 280)
                if isVisible(.created) {
                    TableColumn(DriveColumn.created.title, sortUsing: ListingSort(.created)) { date($0.createdAt) }
                        .width(min: 120, ideal: 150)
                }
                if isVisible(.modified) {
                    TableColumn(DriveColumn.modified.title, sortUsing: ListingSort(.modified)) { date($0.updatedAt) }
                        .width(min: 120, ideal: 150)
                }
                if isVisible(.uploadedBy) {
                    TableColumn(DriveColumn.uploadedBy.title, sortUsing: ListingSort(.uploadedBy)) { Text($0.createdBy) }
                        .width(min: 80, ideal: 120)
                }
                if isVisible(.lastEditedBy) {
                    TableColumn(DriveColumn.lastEditedBy.title, sortUsing: ListingSort(.editedBy)) { Text($0.updatedBy) }
                        .width(min: 80, ideal: 120)
                }
                if isVisible(.size) {
                    TableColumn(DriveColumn.size.title, sortUsing: ListingSort(.size)) { item in
                        Text(item.isFolder ? "—" : Formatting.size(item.size))
                            .foregroundStyle(item.isFolder ? .secondary : .primary)
                            .help(item.isFolder ? "" : Formatting.detailedSize(item.size))
                    }
                    .width(min: 60, ideal: 80)
                }
            } rows: {
                ForEach(model.rows) { item in
                    if item.isFolder {
                        TableRow(item)
                            .itemProvider { model.dragProvider(for: item) }
                            .dropDestination(for: DriveNodeDrag.self) { drags in
                                _ = dropMove(drags.map(\.id), to: item.id, named: item.name)
                            }
                    } else {
                        TableRow(item)
                            .itemProvider { model.dragProvider(for: item) }
                    }
                }
                if model.editing == .newFolder {
                    TableRow(DriveItem.newFolder(in: model.folderId))
                }
            }
            .contextMenu(forSelectionType: DriveItem.ID.self) { ids in
                let items = model.rows.filter { ids.contains($0.id) }
                if items.isEmpty { emptySpaceMenu } else { rowMenu(items) }
            } primaryAction: { ids in
                if ids.count == 1, let item = model.rows.first(where: { ids.contains($0.id) }) { openOrPreview(item) }
            }
            .onDeleteCommand { pendingDelete = model.selectedItems }
            .onKeyPress(.return) {
                guard model.editing == nil, let item = model.selectedItem else { return .ignored }
                model.startRename(item)
                return .handled
            }
            .onKeyPress(.space) {
                guard model.editing == nil else { return .ignored }
                showPreview.toggle()
                return .handled
            }
            .onKeyPress(.leftArrow) { stepPreview(-1) }
            .onKeyPress(.rightArrow) { stepPreview(1) }
            .onChange(of: model.reveal) { _, request in
                guard let request else { return }
                model.revealed(request)
                proxy.scrollTo(request.itemId)
            }
        }
    }

    @ViewBuilder
    private func nameCell(_ item: DriveItem, badge: SyncBadges.Badge?) -> some View {
        HStack(spacing: 6) {
            ItemIcon(item)
            if let field = nameField(for: item) {
                field
            } else {
                Text(item.name)
                    .lineLimit(1)
                    .truncationMode(.middle)
                    .help(item.name)
                Spacer(minLength: 0)
                if let badge {
                    Image(systemName: badge.systemImage)
                        .foregroundStyle(badge == .attention ? Color.orange : Color.secondary)
                        .help(badge.help)
                }
            }
        }
    }

    private func nameField(for item: DriveItem) -> InlineNameField? {
        let isNewFolder = item.id == DriveItem.newFolderID
        guard model.editing == (isNewFolder ? .newFolder : .rename(item.id)) else { return nil }
        return InlineNameField(
            initialName: item.name,
            selectStem: !item.isFolder,
            isSaving: model.isSavingName,
            error: model.editError,
            onChange: model.editChanged,
            onCommit: { name, fromBlur in
                Task { await model.commitEdit(name, fromBlur: fromBlur, undoManager: undoManager) }
            },
            onCancel: model.cancelEdit
        )
    }

    private func date(_ date: Date) -> some View {
        Text(Formatting.timestamp(date)).help(Formatting.fullTimestamp(date))
    }

    @ViewBuilder
    private var emptyState: some View {
        if model.nodes.isEmpty, model.filter.isEmpty {
            ContentUnavailableView {
                Label("This folder is empty", systemImage: "folder")
            } description: {
                Text("Drop files here or use Upload files.")
            } actions: {
                Button("Upload files…", action: chooseUploads)
            }
        } else if model.nodes.isEmpty {
            ContentUnavailableView {
                Label("No \(ListingRules.describe(model.filter)) files here", systemImage: "line.3.horizontal.decrease.circle")
            } description: {
                Text("Show all types to see everything in this folder.")
            } actions: {
                Button("Show all types") { model.filter = [] }
            }
        } else {
            ContentUnavailableView {
                Label("No matches for “\(model.trimmedQuery)”", systemImage: "magnifyingglass")
            } description: {
                Text("Try a different name or clear the filter.")
            } actions: {
                Button("Clear filter") { model.nameQuery = "" }
            }
        }
    }

    @ViewBuilder
    private func rowMenu(_ items: [DriveItem]) -> some View {
        let count = items.count > 1 ? " \(items.count) items" : ""
        if items.count == 1, let item = items.first {
            Button(item.isFolder ? "Open" : "Preview") { openOrPreview(item) }
        }
        if canDownload(items) {
            Button(items.count == 1 ? "Download…" : "Download \(items.count) files…") { download(items) }
        }
        Divider()
        if items.count == 1, let item = items.first {
            Button("Rename") { model.startRename(item) }
        }
        Button("Move\(count) to…") { moveRequest = MoveRequest(items: items) }
        Divider()
        Button("Delete\(count)…", role: .destructive) { pendingDelete = items }
    }

    @ViewBuilder
    private var emptySpaceMenu: some View {
        Button("New folder", action: model.startNewFolder)
        Button("Upload files…", action: chooseUploads)
        Divider()
        Button("Select all", action: model.selectAll)
            .disabled(model.rows.isEmpty)
    }

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        ToolbarItem(placement: .navigation) {
            ControlGroup {
                Button(action: model.goUp) { Label("Back", systemImage: "chevron.left") }
                    .disabled(model.back == nil)
                    .help(model.back.map { "Back to \($0.name) (⌘[)" } ?? "Back")
                Button(action: model.goForward) { Label("Forward", systemImage: "chevron.right") }
                    .disabled(model.forward == nil)
                    .help(model.forward.map { "Forward to \($0.name) (⌘])" } ?? "Forward")
            }
            .controlGroupStyle(.navigation)
        }
        if #available(macOS 26.0, *) {
            DefaultToolbarItem(kind: .search, placement: .primaryAction)
        }
        ToolbarItem(placement: .primaryAction) { viewOptions }
        if #available(macOS 26.0, *) {
            ToolbarSpacer(.fixed, placement: .primaryAction)
        }
        ToolbarItemGroup(placement: .primaryAction) {
            Button(action: model.startNewFolder) { Label("New folder", systemImage: "folder.badge.plus") }
                .help("New folder (⇧⌘N)")
            Button(action: chooseUploads) { Label("Upload files", systemImage: "square.and.arrow.up") }
                .help("Upload files (⌘U)")
        }
        if #available(macOS 26.0, *) {
            ToolbarSpacer(.fixed, placement: .primaryAction)
        }
        ToolbarItem(placement: .primaryAction) {
            Button { showPreview.toggle() } label: { Label("Preview", systemImage: "sidebar.right") }
                .help(showPreview ? "Hide preview (⇧⌘P)" : "Show preview (⇧⌘P)")
        }
    }

    private var viewOptions: some View {
        Menu {
            Menu("File type") {
                let options = model.typeOptions
                Toggle("All files", isOn: Binding(
                    get: { model.filter.isEmpty },
                    set: { if $0 { model.filter = [] } }
                ))
                Toggle("Only .kt and .jpg", isOn: Binding(
                    get: { model.filter == ["kt", "jpg"] },
                    set: { if $0 { model.filter = ["kt", "jpg"] } }
                ))
                Divider()
                ForEach(options) { option in
                    Toggle(".\(option.type) (\(option.count))", isOn: Binding(
                        get: { model.filter.contains(option.type) },
                        set: { if $0 { model.filter.insert(option.type) } else { model.filter.remove(option.type) } }
                    ))
                }
                if options.isEmpty { Text("No file types") }
            }
            Section("Columns") {
                ForEach(DriveColumn.allCases) { column in
                    Toggle(column.title, isOn: Binding(
                        get: { isVisible(column) },
                        set: { model.columns.setVisible($0, for: column) }
                    ))
                    .disabled(!column.isHideable)
                }
            }
        } label: {
            Label("View options", systemImage: model.filter.isEmpty ? "line.3.horizontal.decrease.circle" : "line.3.horizontal.decrease.circle.fill")
        }
        .help("File type and columns")
    }

    private var actions: DriveActions {
        let selected = model.selectedItems
        let single = model.selectedItem
        return DriveActions(
            newFolder: model.startNewFolder,
            upload: chooseUploads,
            open: single.map { item in { openOrPreview(item) } },
            rename: single.map { item in { model.startRename(item) } },
            download: canDownload(selected) ? { download(selected) } : nil,
            moveTo: selected.isEmpty ? nil : { moveRequest = MoveRequest(items: selected) },
            delete: selected.isEmpty ? nil : { pendingDelete = selected },
            back: model.back.map { _ in model.goUp },
            forward: model.forward.map { _ in model.goForward },
            refresh: { Task { await model.reload() } },
            filter: ToolbarSearch.focus,
            isPreviewShown: showPreview,
            togglePreview: { showPreview.toggle() }
        )
    }

    private func openOrPreview(_ item: DriveItem) {
        if item.isFolder {
            model.open(item)
        } else {
            model.selection = [item.id]
            showPreview = true
        }
    }

    private func stepPreview(_ offset: Int) -> KeyPress.Result {
        guard showPreview, model.editing == nil, model.previewNeighbour(offset) != nil else { return .ignored }
        model.stepPreview(offset)
        return .handled
    }

    private func dropMove(_ ids: [String], to parentId: String?, named name: String) -> Bool {
        model.moveDropped(ids, to: parentId, named: name, undoManager: undoManager)
    }

    private func chooseUploads() {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = true
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.prompt = "Upload"
        guard panel.runModal() == .OK else { return }
        model.upload(panel.urls)
    }

    private func canDownload(_ items: [DriveItem]) -> Bool {
        !items.isEmpty && !items.contains(where: \.isFolder)
    }

    private func download(_ item: DriveItem) {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = item.name
        panel.canCreateDirectories = true
        guard panel.runModal() == .OK, let url = panel.url else { return }
        Task { await model.download(item, to: url) }
    }

    private func download(_ items: [DriveItem]) {
        guard canDownload(items) else { return }
        if items.count == 1 { return download(items[0]) }
        let panel = NSOpenPanel()
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.canCreateDirectories = true
        panel.allowsMultipleSelection = false
        panel.prompt = "Download"
        panel.message = "Choose where to save \(items.count) files."
        guard panel.runModal() == .OK, let folder = panel.url else { return }
        Task { await model.download(items, into: folder) }
    }

    private var deleteTitle: String {
        pendingDelete.count == 1 ? "Delete “\(pendingDelete[0].name)”?" : "Delete \(pendingDelete.count) items?"
    }

    private var deleteMessage: String {
        let base = "It's removed from your drive and from every synced folder. This can't be undone."
        return pendingDelete.contains(where: \.isFolder)
            ? "Folders are deleted with everything in them. " + base
            : base
    }
}

private struct UploadConflictDialog: View {
    let model: DriveViewModel
    @State private var applyToAll = false

    var body: some View {
        let dialog = Color.clear.confirmationDialog(
            "“\(model.conflict?.name ?? "")” already exists",
            isPresented: Binding(
                get: { model.conflict != nil },
                set: { isShown in
                    guard !isShown, let shown = model.conflict?.id else { return }
                    DispatchQueue.main.async { model.resolveConflict(.skip, ifStill: shown) }
                }
            ),
            titleVisibility: .visible,
            presenting: model.conflict
        ) { conflict in
            Button("Keep both") { resolve(.keepBoth) }
                .keyboardShortcut(.defaultAction)
            if conflict.canReplace {
                Button("Replace", role: .destructive) { resolve(.replace) }
            }
            Button("Skip", role: .cancel) { resolve(.skip) }
        } message: { conflict in
            Text(conflict.message)
        }
        .onChange(of: model.conflict?.id) { applyToAll = false }

        if model.conflict?.offersApplyToAll == true {
            dialog.dialogSuppressionToggle("Do this for the rest of this upload", isSuppressed: $applyToAll)
        } else {
            dialog
        }
    }

    private func resolve(_ choice: ConflictChoice) {
        model.resolveConflict(choice, applyToAll: applyToAll)
    }
}

private struct Breadcrumb: View {
    let path: [DriveItem]
    let navigate: (String?) -> Void
    let drop: (_ ids: [String], _ parentId: String?, _ name: String) -> Bool

    var body: some View {
        HStack(spacing: 2) {
            Crumb(title: "My Drive", id: nil, fullPath: "My Drive", isCurrent: path.isEmpty, navigate: navigate, drop: drop)
            ForEach(Array(path.enumerated()), id: \.element.id) { index, folder in
                Image(systemName: "chevron.right").font(.caption).foregroundStyle(.secondary)
                Crumb(
                    title: folder.name,
                    id: folder.id,
                    fullPath: (["My Drive"] + path[...index].map(\.name)).joined(separator: " › "),
                    isCurrent: index == path.count - 1,
                    navigate: navigate,
                    drop: drop
                )
            }
            Spacer()
        }
        .padding(.horizontal, Layout.inset - 4)
        .frame(height: Layout.barHeight)
    }
}

private struct Crumb: View {
    let title: String
    let id: String?
    let fullPath: String
    let isCurrent: Bool
    let navigate: (String?) -> Void
    let drop: (_ ids: [String], _ parentId: String?, _ name: String) -> Bool
    @State private var isTargeted = false

    var body: some View {
        if isCurrent {
            CurrentCrumb(title: title).help(fullPath)
        } else {
            Button(title) { navigate(id) }
                .buttonStyle(CrumbButtonStyle(isTargeted: isTargeted))
                .help(fullPath)
                .dropDestination(for: DriveNodeDrag.self) { drags, _ in
                    drop(drags.map(\.id), id, title)
                } isTargeted: { isTargeted = $0 }
        }
    }
}

private struct StatusBar: View {
    let model: DriveViewModel
    let sync: SyncSummary
    let showSync: () -> Void

    var body: some View {
        HStack(spacing: Layout.spacing) {
            if let error = model.editError {
                Label(error, systemImage: "exclamationmark.circle.fill")
                    .foregroundStyle(.red)
                    .lineLimit(1)
            } else if let activity = model.activity {
                ProgressView().controlSize(.small)
                Text(activity).lineLimit(1)
            } else if let message = model.statusMessage {
                Label(message, systemImage: "checkmark.circle")
                    .lineLimit(1)
            } else if model.isLoading {
                ProgressView().controlSize(.small)
            }
            Spacer()
            Text(model.summary).foregroundStyle(.secondary).lineLimit(1)
            Divider().frame(height: 12)
            Button(action: showSync) {
                Label(sync.title, systemImage: sync.systemImage)
                    .lineLimit(1)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .foregroundStyle(.secondary)
            .help(sync.help)
        }
        .font(.callout)
        .padding(.horizontal, Layout.inset)
        .frame(height: Layout.barHeight)
    }
}

extension DriveItem {
    static let newFolderID = "new-folder"

    static func newFolder(in parentId: String?) -> DriveItem {
        DriveItem(
            id: newFolderID,
            parentId: parentId,
            name: "Untitled folder",
            kind: .folder,
            size: 0,
            contentType: nil,
            fileType: "",
            preview: .none,
            revision: 0,
            createdAt: .now,
            createdBy: "",
            updatedAt: .now,
            updatedBy: ""
        )
    }
}

@MainActor
func isPresent<T>(_ binding: Binding<T?>) -> Binding<Bool> {
    Binding(get: { binding.wrappedValue != nil }, set: { if !$0 { binding.wrappedValue = nil } })
}

@MainActor
func isPresent<T>(_ binding: Binding<[T]>) -> Binding<Bool> {
    Binding(get: { !binding.wrappedValue.isEmpty }, set: { if !$0 { binding.wrappedValue = [] } })
}
