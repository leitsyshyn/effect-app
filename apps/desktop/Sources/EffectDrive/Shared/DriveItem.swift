import Foundation

struct DriveItem: Identifiable, Hashable, Sendable {
    enum Kind: String, Sendable {
        case file
        case folder
    }

    let id: String
    let parentId: String?
    let name: String
    let kind: Kind
    let size: Int
    let contentType: String?
    let fileType: String
    let preview: PreviewKind
    let revision: Int
    let createdAt: Date
    let createdBy: String
    let updatedAt: Date
    let updatedBy: String

    var isFolder: Bool { kind == .folder }
}

struct FolderListing: Sendable, Equatable {
    let path: [DriveItem]
    let nodes: [DriveItem]
    let types: [ListingRules.TypeOption]
}

struct AccountUser: Sendable, Equatable {
    let id: String
    let name: String
    let email: String
}

enum Timestamp {
    static func parse(_ value: String) throws -> Date {
        if let date = try? Date(value, strategy: .iso8601WithFractionalSeconds) { return date }
        if let date = try? Date(value, strategy: .iso8601) { return date }
        throw AppError.unexpected(status: nil, detail: "Unreadable timestamp “\(value)”")
    }
}

extension ParseStrategy where Self == Date.ISO8601FormatStyle {
    static var iso8601WithFractionalSeconds: Date.ISO8601FormatStyle {
        Date.ISO8601FormatStyle(includingFractionalSeconds: true)
    }
}
