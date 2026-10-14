import AppKit
import Foundation
import Testing
import UniformTypeIdentifiers
@testable import EffectDrive

@Suite("Row drag payload")
struct DriveNodeDragTests {
    @Test("The drag type resolves from its pasteboard identifier without an Info.plist declaration")
    func typeResolvesFromIdentifier() {
        #expect(UTType.driveNode != .data)
        let resolved = UTType(UTType.driveNode.identifier)
        #expect(resolved == .driveNode)
        #expect(resolved?.conforms(to: .data) == true)
    }

    @Test("A row's provider hands the node id to a drop destination")
    func providerRoundTrip() async throws {
        let provider = NSItemProvider()
        DriveNodeDrag.register("node-1", on: provider)
        #expect(provider.hasItemConformingToTypeIdentifier(UTType.driveNode.identifier))

        let data: Data = try await withCheckedThrowingContinuation { continuation in
            _ = provider.loadDataRepresentation(forTypeIdentifier: UTType.driveNode.identifier) { data, error in
                if let data { continuation.resume(returning: data) } else {
                    continuation.resume(throwing: error ?? CocoaError(.fileReadUnknown))
                }
            }
        }
        #expect(try JSONDecoder().decode(DriveNodeDrag.self, from: data).id == "node-1")
    }
}
