import Foundation

enum ErrorAction: Equatable, Sendable {
    case none
    case signOut
    case refresh
    case resolveNameConflict
    case showDaemonHint
}

enum AppError: Error, Equatable, Sendable {
    case unauthorized
    case network(String)
    case unexpected(status: Int?, detail: String)

    case authFailed(String)
    case nameConflict(name: String)
    case revisionMismatch
    case nodeNotFound
    case parentNotFolder
    case notAFile
    case invalidMove(reason: String)
    case invalidUpload(reason: String)

    case daemonUnreachable
    case daemonRejectedControlToken
    case daemonNotSignedIn
    case invalidFolder(reason: String)
    case issueNotFound

    static let daemonHint = "Sync daemon not running — start it with `bun run dev:sync`"

    var message: String {
        switch self {
        case .unauthorized:
            "Session ended. Sign in again"
        case .network:
            "Couldn't reach the server"
        case .unexpected(let status, let detail):
            if let status {
                status >= 500 ? "Server error. Try again" : "Request refused (HTTP \(status))"
            } else {
                detail.isEmpty ? "Something went wrong. Try again" : detail
            }
        case .authFailed(let reason):
            reason
        case .nameConflict(let name):
            "“\(name)” already exists here"
        case .revisionMismatch:
            "Changed elsewhere in the meantime. Try again"
        case .nodeNotFound:
            "This item no longer exists"
        case .parentNotFolder:
            "The destination isn't a folder"
        case .notAFile:
            "A folder with this name is in the way"
        case .invalidMove(let reason):
            "Can't move here: \(reason)"
        case .invalidUpload(let reason):
            "Upload rejected: \(reason)"
        case .daemonUnreachable:
            Self.daemonHint
        case .daemonRejectedControlToken:
            "The sync daemon rejected the control token. Restart it with `bun run dev:sync`"
        case .daemonNotSignedIn:
            "Sync isn't signed in yet. Try again in a moment"
        case .invalidFolder(let reason):
            "Can't link this folder: \(reason)"
        case .issueNotFound:
            "Already resolved"
        }
    }

    var action: ErrorAction {
        switch self {
        case .unauthorized: .signOut
        case .revisionMismatch, .nodeNotFound: .refresh
        case .nameConflict: .resolveNameConflict
        case .daemonUnreachable, .daemonRejectedControlToken: .showDaemonHint
        default: .none
        }
    }
}

extension AppError: LocalizedError {
    var errorDescription: String? { message }
}

extension Error {
    var asAppError: AppError {
        if let error = self as? AppError { return error }
        return .unexpected(status: nil, detail: localizedDescription)
    }
}
