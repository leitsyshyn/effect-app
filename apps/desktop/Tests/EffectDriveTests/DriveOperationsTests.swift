import Foundation
import HTTPTypes
import OpenAPIRuntime
import Testing
@testable import EffectDrive

final class RecordingTransport: ClientTransport, @unchecked Sendable {
    typealias Handler = @Sendable (HTTPRequest, String) async throws -> (HTTPResponse, HTTPBody?)
    typealias Request = (operationID: String, request: HTTPRequest, baseURL: URL, body: Data)

    private let lock = NSLock()
    private let handler: Handler
    private var recorded: [Request] = []

    init(_ handler: @escaping Handler) { self.handler = handler }

    var requests: [Request] { lock.withLock { recorded } }

    func send(_ request: HTTPRequest, body: HTTPBody?, baseURL: URL, operationID: String) async throws -> (HTTPResponse, HTTPBody?) {
        let data = if let body { try await Data(collecting: body, upTo: 1 << 20) } else { Data() }
        lock.withLock { recorded.append((operationID, request, baseURL, data)) }
        return try await handler(request, operationID)
    }
}

extension HTTPRequest {
    var query: [String: String] {
        let items = URLComponents(string: path ?? "")?.queryItems ?? []
        return Dictionary(items.map { ($0.name, $0.value ?? "") }, uniquingKeysWith: { $1 })
    }
}

private let itemId = "3e9364bc-7d25-4214-9389-0e5b3aac40db"
private let folderId = "9a0b5a43-4a6c-4d4b-9a54-1c4f3c7b2f10"

@Suite("Move")
struct MoveTests {
    func body(_ data: Data) throws -> [String: Any] {
        try #require(try JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    @Test("Moving to the root sends an empty move object")
    func moveToRoot() async throws {
        let transport = RecordingTransport { _, _ in StubTransport.response(.ok, json: Fixtures.nodeJSON(id: itemId, revision: 3)) }
        let drive = DriveService(serverURL: Fixtures.server, transport: transport, token: { "session-token" })
        let moved = try await drive.move(Fixtures.item("a.txt", id: itemId, revision: 2), to: nil)

        let request = try #require(transport.requests.first)
        #expect(request.operationID == "drive.updateNode")
        #expect(request.request.method == .patch)
        #expect(request.request.path == "/api/drive/nodes/\(itemId)")
        #expect(request.request.headerFields[.authorization] == "Bearer session-token")
        let sent = try body(request.body)
        #expect(Set(sent.keys) == ["move", "expectedRevision"])
        #expect((sent["move"] as? [String: Any])?.isEmpty == true)
        #expect(sent["expectedRevision"] as? Int == 2)
        #expect(moved.revision == 3)
    }

    @Test("Moving into a folder sends its id in the move object, and the item's revision")
    func moveIntoFolder() async throws {
        let transport = RecordingTransport { _, _ in StubTransport.response(.ok, json: Fixtures.nodeJSON(id: itemId)) }
        let drive = DriveService(serverURL: Fixtures.server, transport: transport, token: { nil })
        _ = try await drive.move(Fixtures.item("a.txt", id: itemId, revision: 5), to: folderId)

        let sent = try body(try #require(transport.requests.first).body)
        #expect((sent["move"] as? [String: Any])?["parentId"] as? String == folderId)
        #expect(sent["expectedRevision"] as? Int == 5)
        #expect(sent["name"] == nil)
    }

    @Test("A rename sends only the name and revision, so the item stays where it is")
    func renameDoesNotMove() async throws {
        let transport = RecordingTransport { _, _ in StubTransport.response(.ok, json: Fixtures.nodeJSON(id: itemId)) }
        let drive = DriveService(serverURL: Fixtures.server, transport: transport, token: { nil })
        _ = try await drive.rename(Fixtures.item("a.txt", id: itemId, revision: 4), to: "b.txt")

        let sent = try body(try #require(transport.requests.first).body)
        #expect(Set(sent.keys) == ["name", "expectedRevision"])
    }

    @Test("Server refusals map to their errors", arguments: [
        (409, #"{"_tag":"InvalidMove","id":"x","reason":"A folder cannot move into itself"}"#, AppError.invalidMove(reason: "A folder cannot move into itself")),
        (409, #"{"_tag":"NameConflict","parentId":{"_tag":"None"},"name":"a.txt"}"#, AppError.nameConflict(name: "a.txt")),
        (409, #"{"_tag":"ParentNotFolder","id":"x"}"#, AppError.parentNotFolder),
        (412, #"{"_tag":"RevisionMismatch","id":"x","expected":1,"actual":2}"#, AppError.revisionMismatch),
        (404, #"{"_tag":"NodeNotFound","id":"x"}"#, AppError.nodeNotFound),
        (401, "", AppError.unauthorized),
    ])
    func errors(status: Int, json: String, expected: AppError) async {
        let transport = StubTransport(status: .init(code: status), json: json)
        do {
            _ = try await Fixtures.drive(transport).move(Fixtures.item("a.txt", id: itemId), to: folderId)
            Issue.record("Expected \(expected)")
        } catch {
            #expect(error == expected)
        }
    }
}

@Suite("Upload")
struct UploadTests {
    @Test("The file is streamed from disk as the multipart `file` part; the name travels in the query")
    func multipartBody() async throws {
        let url = FileManager.default.temporaryDirectory.appending(path: "upload-\(UUID().uuidString).bin")
        let payload = Data((0..<300_000).map { UInt8($0 % 251) })
        try payload.write(to: url)
        let transport = RecordingTransport { _, _ in StubTransport.response(.ok, json: Fixtures.nodeJSON()) }
        let drive = DriveService(serverURL: Fixtures.server, transport: transport, token: { "t" })

        let uploaded = try await drive.upload(fileURL: url, name: "a+b c.txt", parentId: folderId, expectedRevision: 2)

        let request = try #require(transport.requests.first)
        #expect(request.operationID == "drive.uploadFile")
        #expect(request.request.query == ["name": "a+b c.txt", "parentId": folderId, "expectedRevision": "2"])
        #expect(request.request.path?.contains("a%2Bb") == true)
        let contentType = try #require(request.request.headerFields[.contentType])
        #expect(contentType.hasPrefix("multipart/form-data; boundary="))
        let head = String(decoding: request.body.prefix(200), as: UTF8.self)
        #expect(head.contains(#"name="file""#))
        #expect(head.contains(#"filename="a+b c.txt""#))
        #expect(request.body.range(of: payload) != nil)
        #expect(uploaded.fileType == "txt")
        #expect(uploaded.preview == .text)
    }
}

@Suite("NameRules")
struct NameRulesTests {
    @Test("Valid names pass", arguments: ["a.txt", "Untitled folder", "é.txt", ".env", String(repeating: "a", count: 255)])
    func valid(name: String) {
        #expect(NameRules.problem(name) == nil)
    }

    @Test("Invalid names say why", arguments: [
        ("", "Name must not be empty"),
        (String(repeating: "a", count: 256), "Name must be at most 255 characters"),
        (".", "Name must not be '.' or '..'"),
        ("..", "Name must not be '.' or '..'"),
        ("a/b", "Name must not contain '/', '\\' or NUL"),
        ("a\\b", "Name must not contain '/', '\\' or NUL"),
        ("a\0b", "Name must not contain '/', '\\' or NUL"),
        (" a", "Name must not start or end with whitespace"),
        ("a ", "Name must not start or end with whitespace"),
    ])
    func invalid(name: String, problem: String) {
        #expect(NameRules.problem(name) == problem)
    }

    @Test("Length is measured on the NFC form, in UTF-16 units like the server")
    func nfcLength() {
        #expect(NameRules.problem(String(repeating: "e\u{0301}", count: 128)) == nil)
        #expect(NameRules.problem(String(repeating: "😀", count: 128)) == "Name must be at most 255 characters")
    }
}

@Suite("Name filter and icons")
struct NameFilterTests {
    @Test("The name filter is a case-insensitive substring match on files and folders")
    func nameFilter() {
        let items = [Fixtures.item("Report.TXT"), Fixtures.item("reports", kind: .folder), Fixtures.item("photo.jpg")]
        #expect(items.filter { ListingRules.matches($0, nameQuery: "rEpOrT") }.map(\.name) == ["Report.TXT", "reports"])
        #expect(items.filter { ListingRules.matches($0, nameQuery: "  ") }.count == 3)
        #expect(items.filter { ListingRules.matches($0, nameQuery: "zzz") }.isEmpty)
    }

    @Test("Keep Both skips names taken in another letter case")
    func keepBothIgnoresCase() {
        #expect(ConflictNaming.keepBothName(for: "a.txt", taken: ["A (1).TXT"]) == "a (2).txt")
    }

    @Test("Icons follow the server's preview kind, as on the web")
    func icons() {
        #expect(Fixtures.item("x.jpg", preview: .image).systemImage == "photo")
        #expect(Fixtures.item("main.kt", preview: .text).systemImage == "doc.text")
        #expect(Fixtures.item("paper.pdf", preview: .pdf).systemImage == "doc.richtext")
        #expect(Fixtures.item("archive.zip", preview: .none).systemImage == "doc")
        #expect(Fixtures.item("docs", kind: .folder).systemImage == "folder.fill")
    }

    @Test("Detailed sizes add the exact byte count from 1 KB up, like Get Info")
    func detailedSize() {
        #expect(Formatting.detailedSize(512) == Formatting.size(512))
        #expect(Formatting.detailedSize(1_234_567) == "\(Formatting.size(1_234_567)) (\(1_234_567.formatted()) bytes)")
    }
}

@MainActor
@Suite("Drive view model")
struct DriveViewModelTests {
    nonisolated static func node(
        _ id: String,
        _ name: String,
        kind: String = "file",
        parentId: String? = nil,
        modified: String = "2026-10-05T22:03:04.631Z",
        fileType: String = "",
        preview: String = "none"
    ) -> String {
        let parent = parentId.map { "\"\($0)\"" } ?? "null"
        return """
        {"id":"\(id)","parentId":\(parent),"name":"\(name)","kind":"\(kind)","size":6,"contentHash":null,"contentType":null,"fileType":"\(fileType)","preview":"\(preview)","revision":1,"createdAt":"2026-10-05T22:03:04.631Z","createdBy":{"id":"u1","name":"Ann"},"updatedAt":"\(modified)","updatedBy":{"id":"u1","name":"Ann"},"deletedAt":null}
        """
    }

    nonisolated static let listing = """
    {"path":[],"nodes":[\(node("f1", "Photos", kind: "folder")),\(node("n1", "notes.txt")),\(node("n2", "Notes.kt")),\(node("n3", "pic.jpg"))],\
    "types":[{"type":"jpg","count":1},{"type":"kt","count":1},{"type":"txt","count":1}]}
    """

    nonisolated static let ktAndJpgListing = """
    {"path":[],"nodes":[\(node("n2", "Notes.kt")),\(node("n3", "pic.jpg"))],\
    "types":[{"type":"jpg","count":1},{"type":"kt","count":1},{"type":"txt","count":1}]}
    """

    func makeModel(moveStatus: HTTPResponse.Status = .ok) -> (DriveViewModel, RecordingTransport) {
        let transport = RecordingTransport { request, operationID in
            switch operationID {
            case "drive.listFolder":
                return StubTransport.response(.ok, json: request.query["filter"] == "jpg,kt" ? Self.ktAndJpgListing : Self.listing)
            case "drive.updateNode":
                return moveStatus == .ok
                    ? StubTransport.response(.ok, json: Self.node("n1", "notes.txt", parentId: "f1"))
                    : StubTransport.response(moveStatus, json: #"{"_tag":"NameConflict","parentId":{"_tag":"None"},"name":"notes.txt"}"#)
            default: throw URLError(.cannotConnectToHost)
            }
        }
        let model = DriveViewModel(
            service: DriveService(serverURL: Fixtures.server, transport: transport, token: { "t" }),
            columnStore: ColumnVisibilityStore(defaults: UserDefaults(suiteName: "EffectDriveTests.\(UUID().uuidString)")!),
            onUnauthorized: {}
        )
        return (model, transport)
    }

    @Test("The status bar summarises the filters and the selection, worded as on the web")
    func summary() async {
        let (model, _) = makeModel()
        await model.reload()
        #expect(model.summary == "4 items")
        model.filter = ["kt", "jpg"]
        await model.pendingReload?.value
        #expect(model.summary == "2 items · .jpg, .kt")
        model.nameQuery = "NOTES"
        #expect(model.summary == "1 of 2 items match “NOTES” · .jpg, .kt")
        model.filter = []
        await model.pendingReload?.value
        #expect(model.summary == "2 of 4 items match “NOTES”")
        model.selection = ["n1"]
        #expect(model.summary == "1 of 2 selected")
    }

    @Test("Rows the name filter hides are no longer selected")
    func nameFilterPrunesSelection() async {
        let (model, _) = makeModel()
        await model.reload()
        model.selection = ["n1", "n3"]
        model.nameQuery = "pic"
        #expect(model.selection == ["n3"])
    }

    @Test("Dropping onto the current folder or onto a dragged folder is refused")
    func refusedDrops() async {
        let (model, transport) = makeModel()
        await model.reload()
        #expect(!model.moveDropped(["n1"], to: nil, named: "My Drive", undoManager: nil))
        #expect(!model.moveDropped(["f1", "n1"], to: "f1", named: "Photos", undoManager: nil))
        #expect(!model.moveDropped(["missing"], to: "f1", named: "Photos", undoManager: nil))
        #expect(!transport.requests.contains { $0.operationID == "drive.updateNode" })
    }

    @Test("A successful move says so in the status bar and reloads")
    func moveReportsSuccess() async {
        let (model, transport) = makeModel()
        await model.reload()
        let items = model.rows.filter { $0.id == "n1" }
        await model.move(items, to: "f1", named: "Photos")
        #expect(model.statusMessage == "Moved “notes.txt” to Photos")
        #expect(model.alert == nil)
        #expect(transport.requests.filter { $0.operationID == "drive.listFolder" }.count == 2)
    }

    @Test("Failed moves are listed per item")
    func moveReportsFailures() async {
        let (model, _) = makeModel(moveStatus: .conflict)
        await model.reload()
        let items = model.rows.filter { $0.id == "n1" || $0.id == "n3" }
        await model.move(items, to: "f1", named: "Photos")
        #expect(model.alert?.title == "Couldn't move 2 items to Photos")
        #expect(model.alert?.message.contains("“pic.jpg”: Photos already has “notes.txt”") == true)
        #expect(model.statusMessage == nil)
    }

    @Test("A rename saves on Enter, then selects the renamed row")
    func inlineRename() async throws {
        let (model, transport) = makeModel()
        await model.reload()
        let item = try #require(model.rows.first { $0.id == "n1" })
        model.startRename(item)
        #expect(model.editing == .rename("n1"))
        await model.commitEdit("renamed.txt", fromBlur: false)
        #expect(transport.requests.contains { $0.operationID == "drive.updateNode" })
        #expect(model.editing == nil)
        let reveal = try #require(model.reveal)
        #expect(reveal.itemId == "n1")
        model.revealed(reveal)
        #expect(model.selection == ["n1"])
        #expect(model.reveal == nil)
    }

    @Test("A taken name keeps the field open with a short error")
    func renameConflictStaysOpen() async throws {
        let (model, _) = makeModel(moveStatus: .conflict)
        await model.reload()
        model.startRename(try #require(model.rows.first { $0.id == "n3" }))
        await model.commitEdit("notes.txt", fromBlur: true)
        #expect(model.editing == .rename("n3"))
        #expect(model.editError == "“notes.txt” already exists here")
        model.editChanged()
        #expect(model.editError == nil)
    }

    @Test("A bad name is explained after Enter and dropped after clicking away; a blank one cancels")
    func badNames() async throws {
        let (model, transport) = makeModel()
        await model.reload()
        let item = try #require(model.rows.first { $0.id == "n1" })
        model.startRename(item)
        await model.commitEdit("a/b", fromBlur: false)
        #expect(model.editing == .rename("n1"))
        #expect(model.editError == NameRules.problem("a/b"))
        await model.commitEdit("a/b", fromBlur: true)
        #expect(model.editing == nil)
        model.startRename(item)
        await model.commitEdit("   ", fromBlur: false)
        #expect(model.editing == nil)
        #expect(!transport.requests.contains { $0.operationID == "drive.updateNode" })
    }

    @Test("Clicking away from a new folder that was never confirmed drops it")
    func newFolderBlurCancels() async {
        let (model, transport) = makeModel()
        await model.reload()
        model.startNewFolder()
        #expect(model.editing == .newFolder)
        await model.commitEdit("Untitled folder", fromBlur: true)
        #expect(model.editing == nil)
        #expect(!transport.requests.contains { $0.operationID == "drive.createFolder" })
    }

    @Test("A new folder that can't be created keeps its field open with the reason")
    func newFolderFailureStaysOpen() async {
        let (model, transport) = makeModel()
        await model.reload()
        model.startNewFolder()
        await model.commitEdit("Invoices", fromBlur: false)
        #expect(transport.requests.contains { $0.operationID == "drive.createFolder" })
        #expect(model.editing == .newFolder)
        #expect(model.editError == "Couldn't reach the server")
    }

    @Test("A folder that can't be loaded shows the error in place of the list, not an alert")
    func loadFailure() async {
        let transport = StubTransport.unreachable()
        let model = DriveViewModel(
            service: DriveService(serverURL: Fixtures.server, transport: transport, token: { "t" }),
            columnStore: ColumnVisibilityStore(defaults: UserDefaults(suiteName: "EffectDriveTests.\(UUID().uuidString)")!),
            onUnauthorized: {}
        )
        await model.reload()
        guard case .network = model.loadError else {
            Issue.record("Expected a network error, got \(String(describing: model.loadError))")
            return
        }
        #expect(model.alert == nil)
    }

    @Test("← and → step through the files listed, in the server's order, skipping folders")
    func previewStepping() async {
        let (model, _) = makeModel()
        await model.reload()
        #expect(model.previewFiles.map(\.name) == ["notes.txt", "Notes.kt", "pic.jpg"])
        model.selection = ["n2"]
        #expect(model.previewNeighbour(-1)?.id == "n1")
        #expect(model.previewNeighbour(1)?.id == "n3")
        model.selection = ["n3"]
        #expect(model.previewNeighbour(1) == nil)
        model.stepPreview(-1)
        #expect(model.reveal?.itemId == "n2")
    }

    @Test("The app's own drag-out copies dropped back on the table are not uploaded")
    func ownDragOutCopiesAreIgnored() async {
        let (model, _) = makeModel()
        let copy = DragOutFiles.directory.appending(path: "x/notes.txt")
        #expect(model.upload([copy]) == false)
    }
}
