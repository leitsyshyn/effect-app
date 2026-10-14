import DriveAPI
import Foundation

enum SortColumn: String, CaseIterable, Sendable {
    case name
    case created
    case modified
    case uploadedBy = "uploaded-by"
    case editedBy = "edited-by"
    case size

    var firstOrder: SortOrder {
        switch self {
        case .name, .uploadedBy, .editedBy: .forward
        case .created, .modified, .size: .reverse
        }
    }
}

struct ListingSort: SortComparator, Hashable, Sendable {
    var column: SortColumn
    var order: SortOrder

    init(_ column: SortColumn, _ order: SortOrder? = nil) {
        self.column = column
        self.order = order ?? column.firstOrder
    }

    static let `default` = ListingSort(.modified, .reverse)

    var rawValue: String { "\(column.rawValue)-\(order == .forward ? "asc" : "desc")" }

    var query: Operations.listFolder.Input.Query.SortPayload? {
        .init(rawValue: rawValue)
    }

    func compare(_ a: DriveItem, _ b: DriveItem) -> ComparisonResult { .orderedSame }
}

typealias ListingFilter = Set<String>

extension ListingFilter {
    var query: String? { isEmpty ? nil : sorted().joined(separator: ",") }
}

enum ListingRules {
    struct TypeOption: Identifiable, Equatable, Sendable {
        let type: String
        let count: Int

        var id: String { type }
    }

    static func summary(of filter: ListingFilter) -> String {
        filter.sorted().map { ".\($0)" }.joined(separator: ", ")
    }

    static func describe(_ filter: ListingFilter, conjunction: String = "or") -> String {
        let labels = filter.sorted().map { ".\($0)" }
        guard let last = labels.last, labels.count > 1 else { return labels.first ?? "" }
        return "\(labels.dropLast().joined(separator: ", ")) \(conjunction) \(last)"
    }

    static func matches(_ item: DriveItem, nameQuery: String) -> Bool {
        let query = nameQuery.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return true }
        return item.name.precomposedStringWithCanonicalMapping.lowercased()
            .contains(query.precomposedStringWithCanonicalMapping.lowercased())
    }
}
