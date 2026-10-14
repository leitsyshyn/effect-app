import Foundation
import OpenAPIRuntime
import SyncAPI

struct SyncDaemonService: Sendable {
    private let client: Client

    init(daemonURL: URL, transport: any ClientTransport, controlToken: ControlTokenFile) {
        self.client = Client(
            serverURL: daemonURL,
            transport: transport,
            middlewares: [BearerTokenMiddleware(token: { try controlToken.read() })]
        )
    }

    func status() async throws(AppError) -> DaemonStatus {
        try await call {
            switch try await client.getStatus() {
            case .ok(let ok): return try DaemonStatus(try ok.body.json)
            case .unauthorized: throw AppError.daemonRejectedControlToken
            case .undocumented(let status, _): throw AppError.unexpected(status: status, detail: "")
            }
        }
    }

    func statusUpdates() async throws(AppError) -> AsyncThrowingStream<Components.Schemas.SyncStatus, any Error> {
        try await call {
            switch try await client.streamStatus() {
            case .ok(let ok):
                return ServerSentEvents.decode(Components.Schemas.SyncStatus.self, from: try ok.body.textEventStream, daemon: true)
            case .unauthorized: throw AppError.daemonRejectedControlToken
            case .undocumented(let status, _): throw AppError.unexpected(status: status, detail: "")
            }
        }
    }

    func signIn(serverURL: URL, token: String) async throws(AppError) {
        try await call {
            let serverURL = serverURL.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
            switch try await client.putSession(body: .json(.init(serverUrl: serverURL, token: token))) {
            case .ok: return
            case .unauthorized(let unauthorized):
                if case .json(let payload) = unauthorized.body, payload.value1 != nil { throw AppError.unauthorized }
                throw AppError.daemonRejectedControlToken
            case .serviceUnavailable:
                throw AppError.network("The sync daemon couldn't reach the drive server to check your session.")
            case .undocumented(let status, _): throw AppError.unexpected(status: status, detail: "")
            }
        }
    }

    func signOut() async throws(AppError) {
        try await call {
            switch try await client.deleteSession() {
            case .noContent: return
            case .unauthorized: throw AppError.daemonRejectedControlToken
            case .undocumented(let status, _): throw AppError.unexpected(status: status, detail: "")
            }
        }
    }

    func link(localPath: String) async throws(AppError) {
        try await call {
            switch try await client.putLink(body: .json(.init(localPath: localPath))) {
            case .ok: return
            case .badRequest(let bad): throw AppError.invalidFolder(reason: try bad.body.json.reason)
            case .conflict: throw AppError.daemonNotSignedIn
            case .unauthorized: throw AppError.daemonRejectedControlToken
            case .undocumented(let status, _): throw AppError.unexpected(status: status, detail: "")
            }
        }
    }

    func unlink() async throws(AppError) {
        try await call {
            switch try await client.deleteLink() {
            case .noContent: return
            case .unauthorized: throw AppError.daemonRejectedControlToken
            case .undocumented(let status, _): throw AppError.unexpected(status: status, detail: "")
            }
        }
    }

    func syncNow() async throws(AppError) {
        try await call {
            switch try await client.syncNow() {
            case .noContent: return
            case .unauthorized: throw AppError.daemonRejectedControlToken
            case .undocumented(let status, _): throw AppError.unexpected(status: status, detail: "")
            }
        }
    }

    func pause() async throws(AppError) {
        try await call {
            switch try await client.pause() {
            case .noContent: return
            case .unauthorized: throw AppError.daemonRejectedControlToken
            case .undocumented(let status, _): throw AppError.unexpected(status: status, detail: "")
            }
        }
    }

    func resume() async throws(AppError) {
        try await call {
            switch try await client.resume() {
            case .noContent: return
            case .unauthorized: throw AppError.daemonRejectedControlToken
            case .undocumented(let status, _): throw AppError.unexpected(status: status, detail: "")
            }
        }
    }

    func pending() async throws(AppError) -> [PendingSync] {
        try await call {
            switch try await client.pending() {
            case .ok(let ok):
                return try ok.body.json.map {
                    PendingSync(path: $0.path, since: try Timestamp.parse($0.since), lastError: $0.lastError)
                }
            case .unauthorized: throw AppError.daemonRejectedControlToken
            case .undocumented(let status, _): throw AppError.unexpected(status: status, detail: "")
            }
        }
    }

    func issues() async throws(AppError) -> [SyncIssue] {
        try await call {
            switch try await client.issues() {
            case .ok(let ok):
                return try ok.body.json.map {
                    SyncIssue(
                        id: $0.id,
                        kind: $0.kind.rawValue,
                        path: $0.path,
                        detail: $0.detail,
                        localCopy: $0.localCopy,
                        createdAt: try Timestamp.parse($0.createdAt)
                    )
                }
            case .unauthorized: throw AppError.daemonRejectedControlToken
            case .undocumented(let status, _): throw AppError.unexpected(status: status, detail: "")
            }
        }
    }

    func dismissIssue(id: String) async throws(AppError) {
        try await call {
            switch try await client.dismissIssue(path: .init(id: id)) {
            case .noContent: return
            case .notFound: throw AppError.issueNotFound
            case .unauthorized: throw AppError.daemonRejectedControlToken
            case .undocumented(let status, _): throw AppError.unexpected(status: status, detail: "")
            }
        }
    }

    private func call<T>(_ operation: () async throws -> T) async throws(AppError) -> T {
        try await mappingErrors(daemon: true, operation)
    }
}

extension DaemonStatus {
    init(_ status: Components.Schemas.SyncStatus) throws {
        self.init(
            state: SyncState(rawValue: status.state.rawValue) ?? .blocked,
            detail: status.detail,
            userEmail: status.user?.email,
            linkedFolder: status.linkedFolder,
            pendingCount: status.pendingCount,
            issueCount: status.issueCount,
            lastSyncedAt: try status.lastSyncedAt.map(Timestamp.parse)
        )
    }
}
