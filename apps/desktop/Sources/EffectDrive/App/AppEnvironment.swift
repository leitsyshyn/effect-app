import Foundation
import OpenAPIRuntime

struct AppEnvironment: Sendable {
    var endpoints: Endpoints
    var transport: any ClientTransport
    var tokenStore: any TokenStore
    var controlToken: ControlTokenFile
    nonisolated(unsafe) var defaults: UserDefaults

    static func live() -> AppEnvironment {
        AppEnvironment(
            endpoints: .fromEnvironment(),
            transport: Transports.urlSession(),
            tokenStore: KeychainTokenStore(),
            controlToken: .fromEnvironment(),
            defaults: UserDefaults(suiteName: "EffectDrive.desktop") ?? .standard
        )
    }
}

final class SessionToken: @unchecked Sendable {
    private let lock = NSLock()
    private var value: String?

    var current: String? { lock.withLock { value } }

    func set(_ token: String?) { lock.withLock { value = token } }
}

struct AlertMessage: Identifiable, Equatable {
    let id = UUID()
    var title: String
    var message: String

    init(_ error: AppError, title: String = "Something went wrong") {
        self.title = title
        self.message = error.message
    }

    init(title: String, message: String) {
        self.title = title
        self.message = message
    }
}
