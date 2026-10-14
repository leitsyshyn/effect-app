import DriveAPI
import Foundation
import OpenAPIRuntime

struct DriveService: Sendable {
    private let client: Client

    init(serverURL: URL, transport: any ClientTransport, token: @escaping @Sendable () -> String?) {
        self.client = Client(
            serverURL: serverURL,
            transport: transport,
            middlewares: [BearerTokenMiddleware(token: token)]
        )
    }

    func currentUser() async throws(AppError) -> AccountUser {
        try await mappingErrors {
            switch try await client.me() {
            case .ok(let ok):
                let user = try ok.body.json
                return AccountUser(id: user.id, name: user.name, email: user.email)
            case .unauthorized: throw AppError.unauthorized
            case .internalServerError: throw AppError.unexpected(status: 500, detail: "")
            case .undocumented(let status, _): throw AppError.unexpected(status: status, detail: "")
            }
        }
    }

    func listFolder(
        parentId: String?,
        sort: ListingSort = .default,
        filter: ListingFilter = []
    ) async throws(AppError) -> FolderListing {
        try await mappingErrors {
            switch try await client.listFolder(query: .init(parentId: parentId, sort: sort.query, filter: filter.query)) {
            case .ok(let ok):
                let listing = try ok.body.json
                return FolderListing(
                    path: try listing.path.map(DriveItem.init),
                    nodes: try listing.nodes.map(DriveItem.init),
                    types: listing.types.map { ListingRules.TypeOption(type: $0._type, count: $0.count) }
                )
            case .unauthorized: throw AppError.unauthorized
            case .notFound: throw AppError.nodeNotFound
            case .conflict: throw AppError.parentNotFolder
            case .internalServerError: throw AppError.unexpected(status: 500, detail: "")
            case .undocumented(let status, _): throw AppError.unexpected(status: status, detail: "")
            }
        }
    }

    func createFolder(name: String, parentId: String?) async throws(AppError) -> DriveItem {
        try await mappingErrors {
            switch try await client.createFolder(body: .json(.init(parentId: parentId, name: name))) {
            case .created(let created): return try DriveItem(try created.body.json)
            case .unauthorized: throw AppError.unauthorized
            case .notFound: throw AppError.nodeNotFound
            case .conflict(let conflict):
                let payload = try conflict.body.json
                if let nameConflict = payload.value2 { throw AppError.nameConflict(name: nameConflict.name) }
                throw AppError.parentNotFolder
            case .internalServerError: throw AppError.unexpected(status: 500, detail: "")
            case .undocumented(let status, _): throw AppError.unexpected(status: status, detail: "")
            }
        }
    }

    func rename(_ item: DriveItem, to name: String) async throws(AppError) -> DriveItem {
        try await update(item, .init(name: name, expectedRevision: item.revision))
    }

    func move(_ item: DriveItem, to parentId: String?) async throws(AppError) -> DriveItem {
        try await update(item, .init(move: .init(parentId: parentId), expectedRevision: item.revision))
    }

    private func update(_ item: DriveItem, _ body: Operations.updateNode.Input.Body.JsonPayload) async throws(AppError) -> DriveItem {
        try await mappingErrors {
            switch try await client.updateNode(path: .init(id: item.id), body: .json(body)) {
            case .ok(let ok): return try DriveItem(try ok.body.json)
            case .unauthorized: throw AppError.unauthorized
            case .notFound: throw AppError.nodeNotFound
            case .conflict(let conflict):
                let payload = try conflict.body.json
                if let nameConflict = payload.value2 { throw AppError.nameConflict(name: nameConflict.name) }
                if let invalidMove = payload.value3 { throw AppError.invalidMove(reason: invalidMove.reason) }
                throw AppError.parentNotFolder
            case .preconditionFailed: throw AppError.revisionMismatch
            case .internalServerError: throw AppError.unexpected(status: 500, detail: "")
            case .undocumented(let status, _): throw AppError.unexpected(status: status, detail: "")
            }
        }
    }

    func delete(_ item: DriveItem) async throws(AppError) {
        try await mappingErrors {
            switch try await client.deleteNode(path: .init(id: item.id), query: .init(expectedRevision: String(item.revision))) {
            case .noContent: return
            case .unauthorized: throw AppError.unauthorized
            case .notFound: throw AppError.nodeNotFound
            case .preconditionFailed: throw AppError.revisionMismatch
            case .internalServerError: throw AppError.unexpected(status: 500, detail: "")
            case .undocumented(let status, _): throw AppError.unexpected(status: status, detail: "")
            }
        }
    }

    func upload(
        fileURL: URL,
        name: String,
        parentId: String?,
        expectedRevision: Int? = nil
    ) async throws(AppError) -> DriveItem {
        try await mappingErrors {
            let file = HTTPBody(contentsOfFileAt: fileURL)
            let response = try await client.uploadFile(
                query: .init(parentId: parentId, name: name, expectedRevision: expectedRevision.map(String.init)),
                body: .multipartForm([.file(.init(payload: .init(body: file), filename: name))])
            )
            switch response {
            case .ok(let ok): return try DriveItem(try ok.body.json)
            case .badRequest(let bad): throw AppError.invalidUpload(reason: try bad.body.json.reason)
            case .unauthorized: throw AppError.unauthorized
            case .notFound: throw AppError.nodeNotFound
            case .conflict(let conflict):
                let payload = try conflict.body.json
                if let nameConflict = payload.value2 { throw AppError.nameConflict(name: nameConflict.name) }
                if payload.value3 != nil { throw AppError.notAFile }
                throw AppError.parentNotFolder
            case .preconditionFailed: throw AppError.revisionMismatch
            case .internalServerError: throw AppError.unexpected(status: 500, detail: "")
            case .undocumented(let status, _): throw AppError.unexpected(status: status, detail: "")
            }
        }
    }

    func content(of item: DriveItem) async throws(AppError) -> HTTPBody {
        try await mappingErrors {
            switch try await client.downloadFile(path: .init(id: item.id), query: .init(disposition: .attachment)) {
            case .ok(let ok): return try ok.body.binary
            case .unauthorized: throw AppError.unauthorized
            case .notFound: throw AppError.nodeNotFound
            case .conflict: throw AppError.notAFile
            case .internalServerError: throw AppError.unexpected(status: 500, detail: "")
            case .undocumented(let status, _): throw AppError.unexpected(status: status, detail: "")
            }
        }
    }

    func download(_ item: DriveItem, to destination: URL) async throws(AppError) {
        let body = try await content(of: item)
        try await mappingErrors {
            let fileManager = FileManager.default
            if fileManager.fileExists(atPath: destination.path) { try fileManager.removeItem(at: destination) }
            guard fileManager.createFile(atPath: destination.path, contents: nil) else {
                throw AppError.unexpected(status: nil, detail: "Can't create \(destination.path)")
            }
            do {
                let handle = try FileHandle(forWritingTo: destination)
                defer { try? handle.close() }
                for try await chunk in body {
                    try handle.write(contentsOf: chunk)
                }
            } catch {
                try? fileManager.removeItem(at: destination)
                throw error
            }
        }
    }

    func previewData(of item: DriveItem, upTo limit: Int) async throws(AppError) -> Data {
        let body = try await content(of: item)
        return try await mappingErrors { try await Data(collecting: body, upTo: limit) }
    }

    func changeCursors() async throws(AppError) -> AsyncThrowingStream<ChangeNotification, any Error> {
        try await mappingErrors {
            switch try await client.streamChanges() {
            case .ok(let ok): return ServerSentEvents.decode(ChangeNotification.self, from: try ok.body.textEventStream)
            case .unauthorized: throw AppError.unauthorized
            case .internalServerError: throw AppError.unexpected(status: 500, detail: "")
            case .undocumented(let status, _): throw AppError.unexpected(status: status, detail: "")
            }
        }
    }
}

struct ChangeNotification: Decodable, Hashable, Sendable {
    let cursor: String
}

extension DriveItem {
    init(_ node: Components.Schemas.DriveNode) throws {
        self.init(
            id: node.id,
            parentId: node.parentId,
            name: node.name,
            kind: node.kind == .folder ? .folder : .file,
            size: node.size,
            contentType: node.contentType,
            fileType: node.fileType,
            preview: PreviewKind(rawValue: node.preview.rawValue) ?? .none,
            revision: node.revision,
            createdAt: try Timestamp.parse(node.createdAt),
            createdBy: node.createdBy.name,
            updatedAt: try Timestamp.parse(node.updatedAt),
            updatedBy: node.updatedBy.name
        )
    }

    init(_ node: Components.Schemas.DriveNode1) throws {
        self.init(
            id: node.id,
            parentId: node.parentId,
            name: node.name,
            kind: node.kind == .folder ? .folder : .file,
            size: node.size,
            contentType: node.contentType,
            fileType: node.fileType,
            preview: PreviewKind(rawValue: node.preview.rawValue) ?? .none,
            revision: node.revision,
            createdAt: try Timestamp.parse(node.createdAt),
            createdBy: node.createdBy.name,
            updatedAt: try Timestamp.parse(node.updatedAt),
            updatedBy: node.updatedBy.name
        )
    }
}
