import Foundation
import Testing
@testable import EffectDrive

@Suite("Sync status line and row badges")
struct SyncSummaryTests {
    func status(_ state: SyncState, pending: Int = 0, issues: Int = 0, detail: String? = nil) -> DaemonStatus {
        DaemonStatus(
            state: state,
            detail: detail,
            userEmail: "ann@example.com",
            linkedFolder: "/Users/ann/Drive",
            pendingCount: pending,
            issueCount: issues,
            lastSyncedAt: nil
        )
    }

    @Test("The status bar line, worded as on the web", arguments: [
        (SyncState.upToDate, 0, 0, "Up to date"),
        (.syncing, 3, 0, "Syncing 3"),
        (.syncing, 0, 0, "Syncing…"),
        (.attention, 0, 2, "2 need attention"),
        (.upToDate, 0, 1, "1 needs attention"),
        (.syncing, 4, 1, "1 needs attention"),
        (.paused, 2, 1, "Sync paused"),
        (.offline, 0, 0, "Offline"),
        (.blocked, 0, 0, "Sync blocked"),
        (.unlinked, 0, 0, "No folder linked"),
    ])
    func title(state: SyncState, pending: Int, issues: Int, expected: String) {
        let summary = SyncSummary(connection: .connected, status: status(state, pending: pending, issues: issues))
        #expect(summary.title == expected)
    }

    @Test("The tooltip gives the details and says where the click leads")
    func help() {
        let summary = SyncSummary(connection: .connected, status: status(.blocked, detail: "Disk full"))
        #expect(summary.help == "Blocked: Disk full\nLinked folder: /Users/ann/Drive\nClick to open Sync")
    }

    @Test("Without a daemon the line says so")
    func unavailable() {
        #expect(SyncSummary(connection: .unavailable(.daemonUnreachable), status: nil).title == "Sync unavailable")
        #expect(SyncSummary(connection: .connecting, status: nil).title == "Connecting…")
    }

    @Test("Rows waiting to sync or needing attention get a badge, and so do the folders above them")
    func badges() {
        let badges = SyncBadges(pending: ["Photos/2024/a.jpg", "notes.txt"], attention: ["Photos/b.jpg"])
        #expect(badges.badge(for: ["notes.txt"]) == .pending)
        #expect(badges.badge(for: ["Photos", "2024", "a.jpg"]) == .pending)
        #expect(badges.badge(for: ["Photos", "2024"]) == .pending)
        #expect(badges.badge(for: ["Photos", "b.jpg"]) == .attention)
        #expect(badges.badge(for: ["Photos"]) == .attention)
        #expect(badges.badge(for: ["Photos", "c.jpg"]) == nil)
        #expect(badges.badge(for: ["notes"]) == nil)
    }

    @Test("Badges match names regardless of case and Unicode normalization")
    func badgeKeys() {
        let badges = SyncBadges(pending: ["Cafe\u{301}/Menu.TXT"], attention: [])
        #expect(badges.badge(for: ["café", "menu.txt"]) == .pending)
    }
}

@Suite("Back and Forward")
struct FolderTrailTests {
    let a = Fixtures.item("A", kind: .folder, id: "a")
    let b = Fixtures.item("B", kind: .folder, id: "b")
    let c = Fixtures.item("C", kind: .folder, id: "c")
    let x = Fixtures.item("X", kind: .folder, id: "x")

    @Test("Back goes up to the parent; there is no Back from My Drive")
    func back() {
        let trail = FolderTrail()
        #expect(trail.back(from: []) == nil)
        #expect(trail.back(from: [a]) == .root)
        #expect(trail.back(from: [a, b]) == FolderTrail.Stop(id: "a", name: "A"))
    }

    @Test("Forward goes back down the way Back came up")
    func forward() {
        var trail = FolderTrail()
        trail.visit([a, b, c])
        #expect(trail.forward(from: [a, b, c]) == nil)
        trail.visit([a])
        #expect(trail.forward(from: [a]) == FolderTrail.Stop(id: "b", name: "B"))
        trail.visit([])
        #expect(trail.forward(from: []) == FolderTrail.Stop(id: "a", name: "A"))
        trail.visit([a, b])
        #expect(trail.forward(from: [a, b]) == FolderTrail.Stop(id: "c", name: "C"))
    }

    @Test("Opening any other folder starts a new trail")
    func newTrail() {
        var trail = FolderTrail()
        trail.visit([a, b, c])
        trail.visit([a])
        trail.visit([a, x])
        #expect(trail.forward(from: [a, x]) == nil)
        #expect(trail.forward(from: [a]) == FolderTrail.Stop(id: "x", name: "X"))
    }
}
