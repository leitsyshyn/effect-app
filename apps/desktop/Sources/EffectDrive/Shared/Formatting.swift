import Foundation

enum Formatting {
    static func size(_ bytes: Int) -> String {
        ByteCountFormatter.string(fromByteCount: Int64(bytes), countStyle: .file)
    }

    static func detailedSize(_ bytes: Int) -> String {
        bytes < 1024 ? size(bytes) : "\(size(bytes)) (\(bytes.formatted()) bytes)"
    }

    static func timestamp(_ date: Date) -> String {
        date.formatted(date: .abbreviated, time: .shortened)
    }

    static func fullTimestamp(_ date: Date) -> String {
        date.formatted(date: .complete, time: .standard)
    }

    static func relative(_ date: Date) -> String {
        date.formatted(.relative(presentation: .named))
    }
}

enum PreviewKind: String, Equatable, Sendable {
    case text
    case image
    case pdf
    case none
}

extension DriveItem {
    var systemImage: String {
        if isFolder { return "folder.fill" }
        switch preview {
        case .text: return "doc.text"
        case .image: return "photo"
        case .pdf: return "doc.richtext"
        case .none: return "doc"
        }
    }
}
