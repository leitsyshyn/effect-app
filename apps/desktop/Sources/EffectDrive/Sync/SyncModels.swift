import Foundation

enum SyncState: String, Sendable, CaseIterable {
    case signedOut = "signed-out"
    case unlinked
    case paused
    case blocked
    case offline
    case syncing
    case attention
    case upToDate = "up-to-date"

    var title: String {
        switch self {
        case .signedOut: "Not signed in"
        case .unlinked: "No folder linked"
        case .paused: "Paused"
        case .blocked: "Blocked"
        case .offline: "Offline"
        case .syncing: "Syncing…"
        case .attention: "Needs attention"
        case .upToDate: "Up to date"
        }
    }

    var systemImage: String {
        switch self {
        case .signedOut: "person.crop.circle.badge.questionmark"
        case .unlinked: "folder.badge.plus"
        case .paused: "pause.circle"
        case .blocked: "xmark.octagon"
        case .offline: "icloud.slash"
        case .syncing: "arrow.triangle.2.circlepath"
        case .attention: "exclamationmark.triangle"
        case .upToDate: "checkmark.circle"
        }
    }
}

struct DaemonStatus: Equatable, Sendable {
    let state: SyncState
    let detail: String?
    let userEmail: String?
    let linkedFolder: String?
    let pendingCount: Int
    let issueCount: Int
    let lastSyncedAt: Date?
}

struct PendingSync: Identifiable, Equatable, Sendable {
    let path: String
    let since: Date
    let lastError: String?

    var id: String { path }
}

struct SyncIssue: Identifiable, Equatable, Sendable {
    let id: String
    let kind: String
    let path: String
    let detail: String
    let localCopy: String?
    let createdAt: Date

    func revealURL(linkedFolder: String) -> URL {
        URL(fileURLWithPath: linkedFolder).appending(path: localCopy ?? path)
    }
}

struct ControlTokenFile: Sendable {
    let url: URL

    static func fromEnvironment(_ environment: [String: String] = ProcessInfo.processInfo.environment) -> ControlTokenFile {
        if let stateDirectory = environment["SYNC_STATE_DIR"], !stateDirectory.isEmpty {
            return ControlTokenFile(url: URL(fileURLWithPath: stateDirectory).appending(path: "control-token"))
        }
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return ControlTokenFile(url: support.appending(path: "EffectDrive/control-token"))
    }

    func read() throws(AppError) -> String {
        guard let contents = try? String(contentsOf: url, encoding: .utf8) else { throw .daemonUnreachable }
        let token = contents.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !token.isEmpty else { throw .daemonUnreachable }
        return token
    }
}

struct SyncSummary: Equatable {
    let title: String
    let systemImage: String
    let help: String

    init(title: String, systemImage: String, help: String) {
        self.title = title
        self.systemImage = systemImage
        self.help = help
    }

    init(connection: SyncViewModel.Connection, status: DaemonStatus?) {
        guard let status else {
            if case .unavailable = connection {
                self.init(title: "Sync unavailable", systemImage: "bolt.horizontal.circle", help: AppError.daemonHint)
            } else {
                self.init(title: "Connecting…", systemImage: "arrow.triangle.2.circlepath", help: "Connecting to the sync daemon")
            }
            return
        }
        let (title, image): (String, String) = switch status.state {
        case .paused: ("Sync paused", status.state.systemImage)
        case .offline, .signedOut, .unlinked: (status.state.title, status.state.systemImage)
        case .blocked: ("Sync blocked", status.state.systemImage)
        case _ where status.issueCount > 0:
            ("\(status.issueCount) \(status.issueCount == 1 ? "needs" : "need") attention", SyncState.attention.systemImage)
        case .syncing:
            (status.pendingCount > 0 ? "Syncing \(status.pendingCount)" : "Syncing…", status.state.systemImage)
        case .attention, .upToDate: (status.state.title, status.state.systemImage)
        }
        var lines = [status.detail.map { "\(status.state.title): \($0)" } ?? status.state.title]
        if let folder = status.linkedFolder { lines.append("Linked folder: \(folder)") }
        if let last = status.lastSyncedAt { lines.append("Last synced \(Formatting.relative(last))") }
        lines.append("Click to open Sync")
        self.init(title: title, systemImage: image, help: lines.joined(separator: "\n"))
    }
}

struct SyncBadges: Equatable {
    enum Badge: Equatable {
        case pending
        case attention

        var systemImage: String {
            switch self {
            case .pending: "arrow.triangle.2.circlepath"
            case .attention: "exclamationmark.triangle.fill"
            }
        }

        var help: String {
            switch self {
            case .pending: "Waiting to sync"
            case .attention: "Needs attention. See Sync for details"
            }
        }
    }

    private var badges: [String: Badge] = [:]

    static let none = SyncBadges()

    private init() {}

    init(pending: [String], attention: [String]) {
        for path in pending { mark(path, .pending) }
        for path in attention { mark(path, .attention) }
    }

    func badge(for path: [String]) -> Badge? {
        badges[Self.key(path.joined(separator: "/"))]
    }

    private mutating func mark(_ path: String, _ badge: Badge) {
        var segments = path.split(separator: "/").map(String.init)
        while !segments.isEmpty {
            let key = Self.key(segments.joined(separator: "/"))
            if badges[key] != .attention { badges[key] = badge }
            segments.removeLast()
        }
    }

    private static func key(_ path: String) -> String {
        path.precomposedStringWithCanonicalMapping.lowercased()
    }
}
