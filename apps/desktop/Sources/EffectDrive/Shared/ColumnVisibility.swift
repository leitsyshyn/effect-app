import Foundation

enum DriveColumn: String, CaseIterable, Identifiable, Sendable {
    case name
    case created
    case modified
    case uploadedBy
    case lastEditedBy
    case size

    var id: String { rawValue }

    var title: String {
        switch self {
        case .name: "Name"
        case .created: "Uploaded at"
        case .modified: "Last edited at"
        case .uploadedBy: "Uploaded by"
        case .lastEditedBy: "Last edited by"
        case .size: "Size"
        }
    }

    var isHideable: Bool { self != .name }

    static var hideable: [DriveColumn] { allCases.filter(\.isHideable) }
}

struct ColumnVisibility: Equatable, Sendable {
    private(set) var hidden: Set<DriveColumn> = []
    private(set) var shown: Set<DriveColumn> = []

    static let allVisible = ColumnVisibility()

    static let besidePreviewHidden: Set<DriveColumn> = [.created, .uploadedBy, .lastEditedBy]

    init(hidden: Set<DriveColumn> = [], shown: Set<DriveColumn> = []) {
        self.hidden = hidden.filter(\.isHideable)
        self.shown = shown.filter(\.isHideable).subtracting(self.hidden)
    }

    func isVisible(_ column: DriveColumn, besidePreview: Bool = false) -> Bool {
        if hidden.contains(column) { return false }
        if shown.contains(column) { return true }
        return !(besidePreview && Self.besidePreviewHidden.contains(column))
    }

    mutating func setVisible(_ visible: Bool, for column: DriveColumn) {
        guard column.isHideable else { return }
        if visible {
            hidden.remove(column)
            shown.insert(column)
        } else {
            shown.remove(column)
            hidden.insert(column)
        }
    }
}

struct ColumnVisibilityStore: Sendable {
    static let key = "drive.hiddenColumns"
    static let shownKey = "drive.shownColumns"

    nonisolated(unsafe) let defaults: UserDefaults

    func load() -> ColumnVisibility {
        ColumnVisibility(hidden: columns(forKey: Self.key), shown: columns(forKey: Self.shownKey))
    }

    func save(_ visibility: ColumnVisibility) {
        defaults.set(visibility.hidden.map(\.rawValue).sorted(), forKey: Self.key)
        defaults.set(visibility.shown.map(\.rawValue).sorted(), forKey: Self.shownKey)
    }

    private func columns(forKey key: String) -> Set<DriveColumn> {
        Set((defaults.stringArray(forKey: key) ?? []).compactMap(DriveColumn.init(rawValue:)))
    }
}
