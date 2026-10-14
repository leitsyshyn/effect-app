import AppKit
import Foundation
import Observation
import PDFKit

enum ConflictChoice: Sendable {
    case replace
    case keepBoth
    case skip
}

struct UploadConflict: Identifiable {
    let id = UUID()
    let name: String
    let message: String
    let canReplace: Bool
    let offersApplyToAll: Bool
    fileprivate let resume: (ConflictChoice, Bool) -> Void
}

enum FilePreview {
    case none
    case loading(DriveItem)
    case text(DriveItem, String)
    case image(DriveItem, NSImage)
    case pdf(DriveItem, PDFDocument)
    case metadata(DriveItem, note: String?)
    case failed(DriveItem, String)
}

enum NameEdit: Equatable {
    case rename(DriveItem.ID)
    case newFolder
}

struct RevealRequest: Equatable {
    let id = UUID()
    let itemId: DriveItem.ID
}

@MainActor
@Observable
final class DriveViewModel {
    private(set) var folderId: String?
    private(set) var path: [DriveItem] = []
    private(set) var nodes: [DriveItem] = []
    private(set) var typeOptions: [ListingRules.TypeOption] = []
    private(set) var isLoading = false
    private(set) var loadError: AppError?
    var sort = ListingSort.default {
        didSet { if sort != oldValue { reloadSoon() } }
    }
    var filter: ListingFilter = [] {
        didSet { if filter != oldValue { reloadSoon() } }
    }
    var nameQuery = "" {
        didSet { pruneSelection() }
    }
    var columns: ColumnVisibility {
        didSet { columnStore.save(columns) }
    }

    var selection: Set<DriveItem.ID> = [] {
        didSet { if selection != oldValue { updatePreview() } }
    }

    private(set) var editing: NameEdit?
    private(set) var editError: String?
    private(set) var isSavingName = false
    private(set) var reveal: RevealRequest?
    private(set) var trail = FolderTrail()

    var alert: AlertMessage?
    var conflict: UploadConflict?
    private(set) var activity: String?
    private(set) var statusMessage: String?
    private(set) var preview = FilePreview.none

    var rows: [DriveItem] { nodes.filter { ListingRules.matches($0, nameQuery: nameQuery) } }

    var selectedItems: [DriveItem] { rows.filter { selection.contains($0.id) } }

    private func pruneSelection() {
        let visible = Set(rows.map(\.id))
        let kept = selection.intersection(visible)
        if kept != selection { selection = kept }
    }

    var selectedItem: DriveItem? {
        let items = selectedItems
        return items.count == 1 ? items[0] : nil
    }

    var previewFiles: [DriveItem] { rows.filter { !$0.isFolder } }

    func selectAll() {
        selection = Set(rows.map(\.id))
    }

    func previewNeighbour(_ offset: Int) -> DriveItem? {
        let files = previewFiles
        guard let current = selectedItem, let index = files.firstIndex(of: current),
              files.indices.contains(index + offset) else { return nil }
        return files[index + offset]
    }

    func stepPreview(_ offset: Int) {
        if let next = previewNeighbour(offset) { reveal = RevealRequest(itemId: next.id) }
    }

    var folderName: String { path.last?.name ?? "My Drive" }

    var trimmedQuery: String { nameQuery.trimmingCharacters(in: .whitespacesAndNewlines) }

    var summary: String {
        let shown = rows.count
        if !selection.isEmpty { return "\(selection.count) of \(shown) selected" }
        let typeFilter = filter.isEmpty ? "" : " · \(ListingRules.summary(of: filter))"
        guard !trimmedQuery.isEmpty else { return "\(Self.count(shown, "item"))\(typeFilter)" }
        let total = nodes.count
        return "\(shown) of \(Self.count(total, "item")) match “\(trimmedQuery)”\(typeFilter)"
    }

    static let textPreviewLimit = 2 * 1024 * 1024
    static let imagePreviewLimit = 40 * 1024 * 1024
    static let pdfPreviewLimit = 50 * 1024 * 1024

    private let service: DriveService
    private let columnStore: ColumnVisibilityStore
    private let onUnauthorized: @MainActor () -> Void
    private var loadGeneration = 0
    private(set) var pendingReload: Task<Void, Never>?
    private var liveUpdates: Task<Void, Never>?
    private var previewTask: Task<Void, Never>?
    private var uploadTask: Task<Void, Never>?
    private var statusMessageTask: Task<Void, Never>?

    init(service: DriveService, columnStore: ColumnVisibilityStore, onUnauthorized: @escaping @MainActor () -> Void) {
        self.service = service
        self.columnStore = columnStore
        self.onUnauthorized = onUnauthorized
        self.columns = columnStore.load()
    }

    func start() {
        Task { await reload() }
        liveUpdates = Task { [weak self] in await self?.followChanges() }
    }

    func stop() {
        liveUpdates?.cancel()
        previewTask?.cancel()
        uploadTask?.cancel()
        statusMessageTask?.cancel()
        conflict?.resume(.skip, false)
        conflict = nil
    }

    func open(_ item: DriveItem) {
        guard item.isFolder else { return }
        navigate(to: item.id)
    }

    func navigate(to folderId: String?) {
        self.folderId = folderId
        selection = []
        nameQuery = ""
        cancelEdit()
        reloadSoon()
    }

    private func reloadSoon() {
        pendingReload = Task { await reload() }
    }

    var back: FolderTrail.Stop? { trail.back(from: path) }

    var forward: FolderTrail.Stop? { trail.forward(from: path) }

    func goUp() {
        if let back { navigate(to: back.id) }
    }

    func goForward() {
        if let forward { navigate(to: forward.id) }
    }

    func reload() async {
        loadGeneration += 1
        let generation = loadGeneration
        let folderId = self.folderId
        isLoading = true
        defer { if generation == loadGeneration { isLoading = false } }
        do {
            let listing = try await service.listFolder(parentId: folderId, sort: sort, filter: filter)
            guard generation == loadGeneration else { return }
            path = listing.path
            nodes = listing.nodes
            typeOptions = listing.types
            loadError = nil
            trail.visit(listing.path)
            pruneSelection()
            if let item = selectedItem { refreshPreviewIfChanged(item) }
        } catch .nodeNotFound where folderId != nil {
            guard generation == loadGeneration else { return }
            self.folderId = nil
            await reload()
        } catch {
            guard generation == loadGeneration else { return }
            if error.action == .signOut { onUnauthorized() } else { loadError = error }
        }
    }

    func listing(of folderId: String?) async throws(AppError) -> FolderListing {
        do {
            return try await service.listFolder(parentId: folderId, sort: ListingSort(.name, .forward))
        } catch {
            if error.action == .signOut { onUnauthorized() }
            throw error
        }
    }

    func startNewFolder() {
        nameQuery = ""
        editError = nil
        editing = .newFolder
    }

    func startRename(_ item: DriveItem) {
        selection = [item.id]
        editError = nil
        editing = .rename(item.id)
    }

    func cancelEdit() {
        editing = nil
        editError = nil
    }

    func editChanged() {
        editError = nil
    }

    func commitEdit(_ rawName: String, fromBlur: Bool, undoManager: UndoManager? = nil) async {
        guard let editing, !isSavingName else { return }
        if fromBlur, editing == .newFolder { return cancelEdit() }
        let name = rawName.precomposedStringWithCanonicalMapping
        if name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return cancelEdit() }
        if let problem = NameRules.problem(name) {
            if fromBlur { cancelEdit() } else { editError = problem }
            return
        }
        isSavingName = true
        defer { isSavingName = false }
        do {
            let saved: DriveItem.ID
            switch editing {
            case .newFolder:
                saved = try await service.createFolder(name: name, parentId: folderId).id
            case .rename(let id):
                guard let item = nodes.first(where: { $0.id == id }) else { return cancelEdit() }
                guard name != item.name else { return cancelEdit() }
                let renamed = try await service.rename(item, to: name)
                registerUndoRename(renamed, back: item.name, undoManager: undoManager)
                saved = id
            }
            await reload()
            self.editing = nil
            editError = nil
            reveal = RevealRequest(itemId: saved)
        } catch {
            switch error.action {
            case .signOut:
                cancelEdit()
                onUnauthorized()
            case .refresh:
                cancelEdit()
                handle(error, refresh: true)
            default:
                editError = error.message
            }
        }
    }

    func revealed(_ request: RevealRequest) {
        guard reveal == request else { return }
        reveal = nil
        if !rows.contains(where: { $0.id == request.itemId }) { nameQuery = "" }
        selection = [request.itemId]
    }

    private func registerUndoRename(_ item: DriveItem, back oldName: String, undoManager: UndoManager?) {
        guard let undoManager else { return }
        undoManager.registerUndo(withTarget: self) { model in
            Task { @MainActor in
                await model.perform("Renaming “\(item.name)”…", success: "Renamed “\(item.name)” back to “\(oldName)”") { [service = model.service] in
                    _ = try await service.rename(item, to: oldName)
                }
            }
        }
        undoManager.setActionName("Rename")
    }

    func delete(_ items: [DriveItem]) async {
        guard !items.isEmpty else { return }
        var failures: [(DriveItem, AppError)] = []
        for (index, item) in items.enumerated() {
            activity = items.count == 1 ? "Deleting “\(item.name)”…" : "Deleting \(index + 1) of \(items.count)…"
            do {
                try await service.delete(item)
            } catch .unauthorized {
                activity = nil
                onUnauthorized()
                return
            } catch {
                failures.append((item, error))
            }
        }
        activity = nil
        report(
            items: items,
            failures: failures,
            success: items.count == 1 ? "Deleted “\(items[0].name)”" : "Deleted \(items.count) items",
            partial: "Deleted \(items.count - failures.count) of \(items.count) items",
            failedOne: "Couldn't delete “\(items[0].name)”",
            failedAll: "Couldn't delete \(items.count) items"
        )
        await reload()
    }

    func move(_ items: [DriveItem], to parentId: String?, named destination: String, undoManager: UndoManager? = nil) async {
        let items = items.filter { $0.parentId != parentId && $0.id != parentId }
        guard !items.isEmpty else { return }
        let origin = items[0].parentId
        let originName = folderName
        var moved: [DriveItem] = []
        var failures: [(DriveItem, AppError)] = []
        for (index, item) in items.enumerated() {
            activity = items.count == 1 ? "Moving “\(item.name)”…" : "Moving \(index + 1) of \(items.count)…"
            do {
                moved.append(try await service.move(item, to: parentId))
            } catch .unauthorized {
                activity = nil
                onUnauthorized()
                return
            } catch {
                failures.append((item, error))
            }
        }
        activity = nil
        report(
            items: items,
            failures: failures,
            success: items.count == 1
                ? "Moved “\(items[0].name)” to \(destination)"
                : "Moved \(items.count) items to \(destination)",
            partial: "Moved \(moved.count) of \(items.count) items to \(destination)",
            failedOne: "Couldn't move “\(items[0].name)” to \(destination)",
            failedAll: "Couldn't move \(items.count) items to \(destination)",
            describe: { error in
                if case .nameConflict(let name) = error { return "\(destination) already has “\(name)”" }
                return error.message
            }
        )
        if let undoManager, !moved.isEmpty {
            undoManager.registerUndo(withTarget: self) { model in
                Task { @MainActor in await model.move(moved, to: origin, named: originName) }
            }
            undoManager.setActionName("Move")
        }
        await reload()
    }

    func moveDropped(_ ids: [String], to parentId: String?, named destination: String, undoManager: UndoManager?) -> Bool {
        let ids = Set(ids)
        guard parentId != folderId, parentId.map({ !ids.contains($0) }) ?? true else { return false }
        let items = nodes.filter { ids.contains($0.id) }
        guard !items.isEmpty else { return false }
        Task { await move(items, to: parentId, named: destination, undoManager: undoManager) }
        return true
    }

    @discardableResult
    func upload(_ urls: [URL]) -> Bool {
        let urls = urls.filter { !DragOutFiles.contains($0) }
        let folders = urls.filter { (try? $0.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true }
        let files = urls.filter { !folders.contains($0) }
        if !folders.isEmpty {
            alert = AlertMessage(
                title: "Folders can't be uploaded",
                message: "Skipped \(folders.map { "“\($0.lastPathComponent)”" }.joined(separator: ", ")). To sync whole folders, link a folder in Sync"
            )
        }
        guard !files.isEmpty else { return !folders.isEmpty }
        let parentId = folderId
        let folderName = self.folderName
        let previous = uploadTask
        uploadTask = Task { [weak self] in
            await previous?.value
            var batchChoice: ConflictChoice?
            var uploaded: [String] = []
            for (index, file) in files.enumerated() {
                guard let self, !Task.isCancelled else { return }
                self.activity = "Uploading \(index + 1) of \(files.count): \(file.lastPathComponent)"
                let name = await self.uploadOne(
                    file,
                    into: parentId,
                    folderName: folderName,
                    remaining: files.count - index - 1,
                    batchChoice: &batchChoice
                )
                if let name { uploaded.append(name) }
            }
            guard let self else { return }
            self.activity = nil
            if !uploaded.isEmpty {
                self.showStatus(uploaded.count == 1 ? "Uploaded “\(uploaded[0])”" : "Uploaded \(uploaded.count) files")
            }
            await self.reload()
        }
        return true
    }

    private func uploadOne(
        _ file: URL,
        into parentId: String?,
        folderName: String,
        remaining: Int,
        batchChoice: inout ConflictChoice?
    ) async -> String? {
        let name = Self.normalized(file.lastPathComponent)
        do {
            do {
                _ = try await service.upload(fileURL: file, name: name, parentId: parentId)
                return name
            } catch .nameConflict {
                return try await resolveConflict(
                    for: file,
                    name: name,
                    parentId: parentId,
                    folderName: folderName,
                    remaining: remaining,
                    batchChoice: &batchChoice
                )
            }
        } catch {
            handle(error, refresh: true)
            return nil
        }
    }

    private func resolveConflict(
        for file: URL,
        name: String,
        parentId: String?,
        folderName: String,
        remaining: Int,
        batchChoice: inout ConflictChoice?
    ) async throws(AppError) -> String? {
        let siblings = try await service.listFolder(parentId: parentId).nodes
        let key = name.lowercased()
        guard let existing = siblings.first(where: { Self.normalized($0.name).lowercased() == key }) else {
            _ = try await service.upload(fileURL: file, name: name, parentId: parentId)
            return name
        }
        var taken = Set(siblings.map(\.name))
        let keepBothName = ConflictNaming.keepBothName(for: name, taken: taken)
        let canReplace = !existing.isFolder

        var choice = batchChoice
        if choice == .replace, !canReplace { choice = nil }
        if choice == nil {
            let message = canReplace
                ? "\(folderName) already has a file with this name. Replace it with the one you're uploading, or keep both as “\(keepBothName)”."
                : "A folder with this name is already in \(folderName), so the file can only be kept under a new name or skipped."
            let (asked, applyToAll) = await ask(UploadConflictQuestion(
                name: name,
                message: message,
                canReplace: canReplace,
                offersApplyToAll: remaining > 0
            ))
            choice = asked
            if applyToAll { batchChoice = asked }
        }

        switch choice ?? .skip {
        case .skip:
            return nil
        case .replace:
            _ = try await service.upload(fileURL: file, name: name, parentId: parentId, expectedRevision: existing.revision)
            return name
        case .keepBoth:
            for _ in 0..<20 {
                let candidate = ConflictNaming.keepBothName(for: name, taken: taken)
                do {
                    _ = try await service.upload(fileURL: file, name: candidate, parentId: parentId)
                    return candidate
                } catch .nameConflict {
                    taken.insert(candidate)
                }
            }
            throw .nameConflict(name: name)
        }
    }

    private struct UploadConflictQuestion {
        let name: String
        let message: String
        let canReplace: Bool
        let offersApplyToAll: Bool
    }

    private func ask(_ question: UploadConflictQuestion) async -> (ConflictChoice, Bool) {
        await withCheckedContinuation { continuation in
            conflict = UploadConflict(
                name: question.name,
                message: question.message,
                canReplace: question.canReplace,
                offersApplyToAll: question.offersApplyToAll
            ) { choice, applyToAll in
                continuation.resume(returning: (choice, applyToAll))
            }
        }
    }

    func resolveConflict(_ choice: ConflictChoice, applyToAll: Bool = false, ifStill id: UploadConflict.ID? = nil) {
        guard let pending = conflict, id == nil || pending.id == id else { return }
        conflict = nil
        pending.resume(choice, applyToAll)
    }

    func download(_ item: DriveItem, to destination: URL) async {
        await perform("Downloading “\(item.name)”…", success: "Downloaded “\(item.name)”", reloadAfter: false) { [service] in
            try await service.download(item, to: destination)
        }
    }

    func download(_ items: [DriveItem], into folder: URL) async {
        let files = items.filter { !$0.isFolder }
        guard !files.isEmpty else { return }
        var taken = Set((try? FileManager.default.contentsOfDirectory(atPath: folder.path)) ?? [])
        var failures: [(DriveItem, AppError)] = []
        for (index, item) in files.enumerated() {
            activity = "Downloading \(index + 1) of \(files.count): \(item.name)"
            let name = taken.contains(where: { $0.lowercased() == item.name.lowercased() })
                ? ConflictNaming.keepBothName(for: item.name, taken: taken)
                : item.name
            taken.insert(name)
            do {
                try await service.download(item, to: folder.appending(path: name))
            } catch .unauthorized {
                activity = nil
                onUnauthorized()
                return
            } catch {
                failures.append((item, error))
            }
        }
        activity = nil
        report(
            items: files,
            failures: failures,
            success: files.count == 1 ? "Downloaded “\(files[0].name)”" : "Downloaded \(files.count) files",
            partial: "Downloaded \(files.count - failures.count) of \(files.count) files",
            failedOne: "Couldn't download “\(files[0].name)”",
            failedAll: "Couldn't download \(files.count) files"
        )
    }

    func dragProvider(for item: DriveItem) -> NSItemProvider {
        let provider = item.isFolder ? NSItemProvider() : DragOutFiles.provider(for: item, service: service)
        if item.isFolder { provider.suggestedName = item.name }
        DriveNodeDrag.register(item.id, on: provider)
        return provider
    }

    private func updatePreview() {
        previewTask?.cancel()
        guard let item = selectedItem else {
            preview = .none
            return
        }
        guard !item.isFolder else {
            preview = .metadata(item, note: nil)
            return
        }
        let kind = item.preview
        let limit = switch kind {
        case .text: Self.textPreviewLimit
        case .image: Self.imagePreviewLimit
        case .pdf, .none: Self.pdfPreviewLimit
        }
        guard kind != .none else {
            preview = .metadata(item, note: nil)
            return
        }
        guard item.size <= limit else {
            preview = .metadata(item, note: "Too large to preview")
            return
        }
        preview = .loading(item)
        previewTask = Task { [weak self, service] in
            let result: FilePreview
            do {
                let data = try await service.previewData(of: item, upTo: limit)
                switch kind {
                case .text:
                    result = .text(item, String(data: data, encoding: .utf8) ?? String(decoding: data, as: UTF8.self))
                case .image:
                    result = NSImage(data: data).map { .image(item, $0) } ?? .failed(item, "This image can't be displayed")
                case .pdf, .none:
                    result = PDFDocument(data: data).map { .pdf(item, $0) } ?? .failed(item, "This PDF can't be displayed")
                }
            } catch {
                guard !Task.isCancelled else { return }
                let error = error.asAppError
                if error.action == .signOut { self?.onUnauthorized() }
                result = .failed(item, error.message)
            }
            guard !Task.isCancelled, let self, self.selectedItem?.id == item.id else { return }
            self.preview = result
        }
    }

    private func refreshPreviewIfChanged(_ item: DriveItem) {
        if preview.item != item { updatePreview() }
    }

    private func followChanges() async {
        var lastCursor: String?
        var failures = 0
        while !Task.isCancelled {
            do {
                let changes = try await service.changeCursors()
                failures = 0
                for try await change in changes {
                    if let lastCursor, lastCursor != change.cursor { await reload() }
                    lastCursor = change.cursor
                }
                try await Task.sleep(for: .milliseconds(500))
            } catch {
                if Task.isCancelled { return }
                if error.asAppError == .unauthorized {
                    onUnauthorized()
                    return
                }
                failures += 1
                let delay = min(30.0, pow(2.0, Double(failures)))
                try? await Task.sleep(for: .seconds(delay))
            }
        }
    }

    private func perform(
        _ description: String,
        success: String? = nil,
        reloadAfter: Bool = true,
        _ operation: @escaping @Sendable () async throws -> Void
    ) async {
        activity = description
        defer { activity = nil }
        do {
            try await operation()
            if let success { showStatus(success) }
            if reloadAfter { await reload() }
        } catch {
            handle(error.asAppError, refresh: true)
        }
    }

    private func report(
        items: [DriveItem],
        failures: [(DriveItem, AppError)],
        success: String,
        partial: String,
        failedOne: String,
        failedAll: String,
        describe: (AppError) -> String = \.message
    ) {
        guard !failures.isEmpty else {
            showStatus(success)
            return
        }
        if items.count == 1, let failure = failures.first {
            show(AlertMessage(title: failedOne, message: describe(failure.1)))
            return
        }
        let lines = failures.map { "“\($0.0.name)”: \(describe($0.1))" }.joined(separator: "\n")
        show(AlertMessage(title: failures.count == items.count ? failedAll : partial, message: lines))
    }

    private func handle(_ error: AppError, refresh: Bool) {
        switch error.action {
        case .signOut:
            onUnauthorized()
        case .refresh where refresh:
            show(AlertMessage(error, title: "The list was out of date"))
            Task { await reload() }
        default:
            show(AlertMessage(error))
        }
    }

    private func show(_ next: AlertMessage) {
        guard let current = alert else {
            alert = next
            return
        }
        guard !current.message.contains(next.message) else { return }
        alert = AlertMessage(title: "Some operations failed", message: "\(current.message)\n\n\(next.message)")
    }

    func showStatus(_ message: String) {
        statusMessage = message
        statusMessageTask?.cancel()
        statusMessageTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(4))
            guard !Task.isCancelled else { return }
            self?.statusMessage = nil
        }
    }

    static func count(_ count: Int, _ noun: String) -> String {
        "\(count) \(noun)\(count == 1 ? "" : "s")"
    }

    static func normalized(_ name: String) -> String {
        name.trimmingCharacters(in: .whitespacesAndNewlines).precomposedStringWithCanonicalMapping
    }
}
