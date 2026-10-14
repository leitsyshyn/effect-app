import Foundation

struct FolderTrail: Equatable, Sendable {
    struct Stop: Equatable, Sendable {
        let id: String?
        let name: String
    }

    private(set) var trail: [DriveItem] = []

    mutating func visit(_ path: [DriveItem]) {
        if !Self.isPrefix(path, of: trail) { trail = path }
    }

    func back(from path: [DriveItem]) -> Stop? {
        guard let parent = path.dropLast().last else { return path.isEmpty ? nil : .root }
        return Stop(id: parent.id, name: parent.name)
    }

    func forward(from path: [DriveItem]) -> Stop? {
        guard Self.isPrefix(path, of: trail), trail.count > path.count else { return nil }
        let next = trail[path.count]
        return Stop(id: next.id, name: next.name)
    }

    private static func isPrefix(_ path: [DriveItem], of other: [DriveItem]) -> Bool {
        path.count <= other.count && zip(path, other).allSatisfy { $0.id == $1.id }
    }
}

extension FolderTrail.Stop {
    static let root = FolderTrail.Stop(id: nil, name: "My Drive")
}
