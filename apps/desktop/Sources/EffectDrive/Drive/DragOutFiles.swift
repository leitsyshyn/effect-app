import Foundation
import UniformTypeIdentifiers

enum DragOutFiles {
    static let directory = FileManager.default.temporaryDirectory
        .appending(path: "EffectDrive-\(ProcessInfo.processInfo.processIdentifier)", directoryHint: .isDirectory)

    static func provider(for item: DriveItem, service: DriveService) -> NSItemProvider {
        let provider = NSItemProvider()
        provider.suggestedName = item.name
        let type = UTType(filenameExtension: (item.name as NSString).pathExtension) ?? .data
        provider.registerFileRepresentation(
            forTypeIdentifier: type.identifier,
            fileOptions: [],
            visibility: .all
        ) { completion in
            let progress = Progress(totalUnitCount: Int64(max(item.size, 1)))
            let task = Task {
                do {
                    let folder = directory.appending(path: UUID().uuidString, directoryHint: .isDirectory)
                    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
                    let destination = folder.appending(path: item.name)
                    try await service.download(item, to: destination)
                    progress.completedUnitCount = progress.totalUnitCount
                    completion(destination, false, nil)
                } catch {
                    completion(nil, false, error)
                }
            }
            progress.cancellationHandler = { task.cancel() }
            return progress
        }
        return provider
    }

    static func contains(_ url: URL) -> Bool {
        let root = directory.resolvingSymlinksInPath().path + "/"
        return url.resolvingSymlinksInPath().path.hasPrefix(root)
    }

    static func removeAll() {
        try? FileManager.default.removeItem(at: directory)
    }
}
