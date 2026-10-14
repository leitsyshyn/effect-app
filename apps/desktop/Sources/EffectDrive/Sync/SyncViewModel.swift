import AppKit
import Foundation
import Observation

@MainActor
@Observable
final class SyncViewModel {
    enum Connection: Equatable {
        case connecting
        case connected
        case unavailable(AppError)
    }

    private(set) var connection = Connection.connecting
    private(set) var status: DaemonStatus?
    private(set) var pending: [PendingSync] = []
    private(set) var issues: [SyncIssue] = []
    private(set) var isWorking = false
    var alert: AlertMessage?

    private let service: SyncDaemonService
    private let serverURL: URL
    private let userEmail: String
    private let sessionToken: @Sendable () -> String?
    private let onUnauthorized: @MainActor () -> Void
    private var following: Task<Void, Never>?
    private var handedOverSession = false
    private var handOverRetryAt: ContinuousClock.Instant?

    init(
        service: SyncDaemonService,
        serverURL: URL,
        userEmail: String,
        sessionToken: @escaping @Sendable () -> String?,
        onUnauthorized: @escaping @MainActor () -> Void
    ) {
        self.service = service
        self.serverURL = serverURL
        self.userEmail = userEmail
        self.sessionToken = sessionToken
        self.onUnauthorized = onUnauthorized
    }

    func start() {
        following = Task { [weak self] in await self?.followStatus() }
    }

    func stop() {
        following?.cancel()
    }

    private func followStatus() async {
        var failures = 0
        while !Task.isCancelled {
            do {
                let updates = try await service.statusUpdates()
                failures = 0
                connection = .connected
                for try await update in updates {
                    let status = try DaemonStatus(update)
                    let previous = self.status
                    self.status = status
                    if needsSession(status) { await handOverSession() }
                    if previous?.pendingCount != status.pendingCount || status.pendingCount > 0
                        || previous?.issueCount != status.issueCount {
                        await refreshLists()
                    }
                }
                try await Task.sleep(for: .milliseconds(500))
            } catch {
                if Task.isCancelled { return }
                connection = .unavailable(error.asAppError)
                status = nil
                pending = []
                issues = []
                failures += 1
                try? await Task.sleep(for: .seconds(min(10.0, Double(failures))))
            }
        }
    }

    private func needsSession(_ status: DaemonStatus) -> Bool {
        if let handOverRetryAt, ContinuousClock.now < handOverRetryAt { return false }
        return !handedOverSession || status.state == .signedOut
            || status.userEmail?.lowercased() != userEmail.lowercased()
    }

    private func handOverSession() async {
        guard let token = sessionToken() else { return }
        do {
            try await service.signIn(serverURL: serverURL, token: token)
            handedOverSession = true
            handOverRetryAt = nil
        } catch .unauthorized {
            onUnauthorized()
        } catch {
            if handOverRetryAt == nil { alert = AlertMessage(error, title: "Couldn't connect the sync daemon") }
            handOverRetryAt = .now + .seconds(10)
        }
    }

    func refreshLists() async {
        do {
            async let pending = service.pending()
            async let issues = service.issues()
            (self.pending, self.issues) = try await (pending, issues)
        } catch {
            alert = AlertMessage(error.asAppError)
        }
    }

    func link(_ folder: URL) async {
        await perform { [service] in try await service.link(localPath: folder.standardizedFileURL.path) }
    }

    func unlink() async {
        await perform { [service] in try await service.unlink() }
    }

    func syncNow() async {
        await perform { [service] in try await service.syncNow() }
    }

    func pause() async {
        await perform { [service] in try await service.pause() }
    }

    func resume() async {
        await perform { [service] in try await service.resume() }
    }

    func dismiss(_ issue: SyncIssue) async {
        await perform { [service] in try await service.dismissIssue(id: issue.id) }
        await refreshLists()
    }

    func reveal(_ issue: SyncIssue) {
        guard let folder = status?.linkedFolder else { return }
        let url = issue.revealURL(linkedFolder: folder)
        if FileManager.default.fileExists(atPath: url.path) {
            NSWorkspace.shared.activateFileViewerSelecting([url])
        } else {
            NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: folder)])
        }
    }

    func revealLinkedFolder() {
        guard let folder = status?.linkedFolder else { return }
        NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: folder)])
    }

    private func perform(_ operation: @escaping @Sendable () async throws -> Void) async {
        isWorking = true
        defer { isWorking = false }
        do {
            try await operation()
        } catch {
            let error = error.asAppError
            if error == .unauthorized { onUnauthorized() } else { alert = AlertMessage(error) }
        }
    }
}
