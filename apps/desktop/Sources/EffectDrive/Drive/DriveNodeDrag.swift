import CoreTransferable
import Foundation
import UniformTypeIdentifiers

extension UTType {
    static let driveNode = UTType(
        tag: "application/x-effect-drive-nodes",
        tagClass: .mimeType,
        conformingTo: .data
    ) ?? .data
}

struct DriveNodeDrag: Transferable, Codable, Sendable {
    let id: String

    static var transferRepresentation: some TransferRepresentation {
        CodableRepresentation(contentType: .driveNode)
    }

    static func register(_ id: String, on provider: NSItemProvider) {
        let data = try? JSONEncoder().encode(DriveNodeDrag(id: id))
        provider.registerDataRepresentation(forTypeIdentifier: UTType.driveNode.identifier, visibility: .ownProcess) { completion in
            completion(data, nil)
            return nil
        }
    }
}
