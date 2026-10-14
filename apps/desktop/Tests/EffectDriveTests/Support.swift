import Foundation
import HTTPTypes
import OpenAPIRuntime
@testable import EffectDrive

final class StubTransport: ClientTransport, @unchecked Sendable {
    typealias Handler = @Sendable (HTTPRequest, URL, String) async throws -> (HTTPResponse, HTTPBody?)

    private let lock = NSLock()
    private var handler: Handler
    private var recorded: [(operationID: String, request: HTTPRequest)] = []

    init(_ handler: @escaping Handler) { self.handler = handler }

    convenience init(status: HTTPResponse.Status, json body: String = "") {
        self.init { _, _, _ in Self.response(status, json: body) }
    }

    static func unreachable() -> StubTransport {
        StubTransport { _, _, _ in throw URLError(.cannotConnectToHost) }
    }

    var requests: [(operationID: String, request: HTTPRequest)] { lock.withLock { recorded } }

    func send(_ request: HTTPRequest, body: HTTPBody?, baseURL: URL, operationID: String) async throws -> (HTTPResponse, HTTPBody?) {
        let handler = lock.withLock {
            recorded.append((operationID, request))
            return self.handler
        }
        return try await handler(request, baseURL, operationID)
    }

    static func response(_ status: HTTPResponse.Status, json body: String, headers: HTTPFields = [:]) -> (HTTPResponse, HTTPBody?) {
        var fields = headers
        if !body.isEmpty { fields[.contentType] = "application/json" }
        return (HTTPResponse(status: status, headerFields: fields), body.isEmpty ? nil : HTTPBody(body))
    }
}

enum Fixtures {
    static let server = URL(string: "http://drive.test")!
    static let daemon = URL(string: "http://daemon.test")!

    static func drive(_ transport: StubTransport, token: String? = "session-token") -> DriveService {
        DriveService(serverURL: server, transport: transport, token: { token })
    }

    static func controlTokenFile() throws -> ControlTokenFile {
        let directory = FileManager.default.temporaryDirectory.appending(path: "EffectDriveTests-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let url = directory.appending(path: "control-token")
        try "control-secret\n".write(to: url, atomically: true, encoding: .utf8)
        return ControlTokenFile(url: url)
    }

    static func item(
        _ name: String,
        kind: DriveItem.Kind = .file,
        modified: TimeInterval = 0,
        created: TimeInterval = 0,
        size: Int = 10,
        uploadedBy: String = "Ann",
        editedBy: String = "Bob",
        id: String = UUID().uuidString,
        revision: Int = 1,
        fileType: String = "",
        preview: PreviewKind = .none
    ) -> DriveItem {
        DriveItem(
            id: id,
            parentId: nil,
            name: name,
            kind: kind,
            size: size,
            contentType: nil,
            fileType: fileType,
            preview: preview,
            revision: revision,
            createdAt: Date(timeIntervalSince1970: created),
            createdBy: uploadedBy,
            updatedAt: Date(timeIntervalSince1970: modified),
            updatedBy: editedBy
        )
    }

    static func nodeJSON(id: String = "3e9364bc-7d25-4214-9389-0e5b3aac40db", name: String = "a.txt", revision: Int = 1) -> String {
        """
        {"id":"\(id)","parentId":null,"name":"\(name)","kind":"file","size":6,"contentHash":null,"contentType":"text/plain","fileType":"txt","preview":"text","revision":\(revision),"createdAt":"2026-10-05T22:03:04.631Z","createdBy":{"id":"u1","name":"Ann"},"updatedAt":"2026-10-05T22:03:04.631Z","updatedBy":{"id":"u1","name":"Ann"},"deletedAt":null}
        """
    }
}
