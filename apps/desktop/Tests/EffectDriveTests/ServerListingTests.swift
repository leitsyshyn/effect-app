import Foundation
import HTTPTypes
import OpenAPIRuntime
import Testing
@testable import EffectDrive

@MainActor
@Suite("Server-owned listing")
struct ServerListingTests {
    typealias Node = DriveViewModelTests

    nonisolated static let everything = """
    {"path":[],"nodes":[\
    \(Node.node("a", "Main.kt", modified: "2026-10-04T10:00:00.000Z", fileType: "kt", preview: "text")),\
    \(Node.node("b", "notes.txt", modified: "2026-10-03T10:00:00.000Z", fileType: "txt", preview: "text")),\
    \(Node.node("c", "photo.JPG", modified: "2026-10-02T10:00:00.000Z", fileType: "jpg", preview: "image")),\
    \(Node.node("d", "pic.jpg", modified: "2026-10-01T10:00:00.000Z", fileType: "jpg", preview: "image"))],\
    "types":[{"type":"jpg","count":2},{"type":"kt","count":1},{"type":"txt","count":1}]}
    """

    nonisolated static let ktAndJpgOldestFirst = """
    {"path":[],"nodes":[\
    \(Node.node("c", "photo.JPG", modified: "2026-10-02T10:00:00.000Z", fileType: "jpg", preview: "image")),\
    \(Node.node("d", "pic.jpg", modified: "2026-10-01T10:00:00.000Z", fileType: "jpg", preview: "image")),\
    \(Node.node("a", "Main.kt", modified: "2026-10-04T10:00:00.000Z", fileType: "kt", preview: "text"))],\
    "types":[{"type":"jpg","count":2},{"type":"kt","count":1},{"type":"txt","count":1}]}
    """

    func makeModel() -> (DriveViewModel, RecordingTransport) {
        let transport = RecordingTransport { request, operationID in
            guard operationID == "drive.listFolder" else { throw URLError(.cannotConnectToHost) }
            let filtered = request.query["filter"] != nil
            return StubTransport.response(.ok, json: filtered ? Self.ktAndJpgOldestFirst : Self.everything)
        }
        let model = DriveViewModel(
            service: DriveService(serverURL: Fixtures.server, transport: transport, token: { "t" }),
            columnStore: ColumnVisibilityStore(defaults: UserDefaults(suiteName: "EffectDriveTests.\(UUID().uuidString)")!),
            onUnauthorized: {}
        )
        return (model, transport)
    }

    func listingQueries(_ transport: RecordingTransport) -> [[String: String]] {
        transport.requests.filter { $0.operationID == "drive.listFolder" }.map(\.request.query)
    }

    @Test("Modified ascending with the .kt and .jpg filter asks the server for exactly that and shows its rows and types as returned")
    func sortByModifiedAscendingWithKtAndJpgFilter() async throws {
        let (model, transport) = makeModel()
        await model.reload()
        #expect(listingQueries(transport).last == ["sort": "modified-desc"])

        model.sort = ListingSort(.modified, .forward)
        await model.pendingReload?.value
        #expect(listingQueries(transport).last == ["sort": "modified-asc"])

        model.filter = ["kt", "jpg"]
        await model.pendingReload?.value
        #expect(listingQueries(transport).last == ["sort": "modified-asc", "filter": "jpg,kt"])

        #expect(model.rows.map(\.name) == ["photo.JPG", "pic.jpg", "Main.kt"])
        #expect(model.rows.map(\.fileType) == ["jpg", "jpg", "kt"])
        #expect(model.rows.map(\.preview) == [.image, .image, .text])
        #expect(model.typeOptions == [
            .init(type: "jpg", count: 2), .init(type: "kt", count: 1), .init(type: "txt", count: 1),
        ])
        #expect(model.summary == "3 items · .jpg, .kt")
    }

    @Test("Clearing the filter asks for everything again; the name filter stays on screen only")
    func clearingFilterAndNameFilter() async throws {
        let (model, transport) = makeModel()
        model.filter = ["kt", "jpg"]
        await model.pendingReload?.value
        model.filter = []
        await model.pendingReload?.value
        #expect(listingQueries(transport).last == ["sort": "modified-desc"])
        #expect(model.rows.map(\.name) == ["Main.kt", "notes.txt", "photo.JPG", "pic.jpg"])

        let requests = transport.requests.count
        model.nameQuery = "PIC"
        #expect(model.rows.map(\.name) == ["pic.jpg"])
        #expect(transport.requests.count == requests)
    }
}
