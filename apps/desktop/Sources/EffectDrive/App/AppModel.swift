import Foundation
import Observation

@MainActor
@Observable
final class AppModel {
    enum Phase: Equatable {
        case restoring
        case signedOut
        case unavailable(String)
        case signedIn
    }

    private(set) var phase = Phase.restoring
    private(set) var user: AccountUser?
    private(set) var drive: DriveViewModel?
    private(set) var sync: SyncViewModel?
    var signInNotice: String?

    let environment: AppEnvironment
    private let token = SessionToken()
    private let auth: AuthService
    private let driveService: DriveService
    private let daemon: SyncDaemonService

    init(environment: AppEnvironment) {
        self.environment = environment
        let token = self.token
        auth = AuthService(serverURL: environment.endpoints.server, transport: environment.transport)
        driveService = DriveService(
            serverURL: environment.endpoints.server,
            transport: environment.transport,
            token: { token.current }
        )
        daemon = SyncDaemonService(
            daemonURL: environment.endpoints.daemon,
            transport: environment.transport,
            controlToken: environment.controlToken
        )
    }

    func restore() async {
        guard let saved = environment.tokenStore.load() else {
            phase = .signedOut
            return
        }
        token.set(saved)
        do {
            let user = try await driveService.currentUser()
            startSession(user: user)
        } catch .unauthorized {
            token.set(nil)
            environment.tokenStore.delete()
            phase = .signedOut
        } catch {
            phase = .unavailable(error.message)
        }
    }

    func signIn(email: String, password: String) async throws(AppError) {
        let sessionToken = try await auth.signIn(email: email, password: password)
        try await begin(with: sessionToken)
    }

    func signUp(name: String, email: String, password: String) async throws(AppError) {
        let sessionToken = try await auth.signUp(name: name, email: email, password: password)
        try await begin(with: sessionToken)
    }

    func signOut(reason: String? = nil) async {
        let endedToken = token.current
        token.set(nil)
        drive?.stop()
        sync?.stop()
        drive = nil
        sync = nil
        user = nil
        signInNotice = reason
        phase = .signedOut
        environment.tokenStore.delete()
        DragOutFiles.removeAll()

        if let endedToken { try? await auth.signOut(token: endedToken) }
        try? await daemon.signOut()
    }

    func sessionExpired() {
        guard phase == .signedIn else { return }
        Task { await signOut(reason: AppError.unauthorized.message) }
    }

    private func begin(with sessionToken: String) async throws(AppError) {
        token.set(sessionToken)
        let user: AccountUser
        do {
            user = try await driveService.currentUser()
        } catch {
            token.set(nil)
            throw error
        }
        try? environment.tokenStore.save(sessionToken)
        signInNotice = nil
        startSession(user: user)
    }

    private func startSession(user: AccountUser) {
        self.user = user
        let drive = DriveViewModel(
            service: driveService,
            columnStore: ColumnVisibilityStore(defaults: environment.defaults),
            onUnauthorized: { [weak self] in self?.sessionExpired() }
        )
        let token = self.token
        let sync = SyncViewModel(
            service: daemon,
            serverURL: environment.endpoints.server,
            userEmail: user.email,
            sessionToken: { token.current },
            onUnauthorized: { [weak self] in self?.sessionExpired() }
        )
        self.drive = drive
        self.sync = sync
        phase = .signedIn
        drive.start()
        sync.start()
    }
}
