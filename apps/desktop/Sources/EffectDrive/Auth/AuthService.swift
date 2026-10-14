import AuthAPI
import Foundation
import OpenAPIRuntime

struct AuthService: Sendable {
    private let serverURL: URL
    private let transport: any ClientTransport

    init(serverURL: URL, transport: any ClientTransport) {
        self.serverURL = serverURL
        self.transport = transport
    }

    private func client(token: String? = nil) -> Client {
        Client(
            serverURL: serverURL.appending(path: "api/auth"),
            configuration: Configuration(dateTranscoder: ServerDateTranscoder()),
            transport: transport,
            middlewares: [BearerTokenMiddleware(token: { token })]
        )
    }

    func signIn(email: String, password: String) async throws(AppError) -> String {
        try await mappingErrors {
            switch try await client().signInEmail(body: .json(.init(email: email, password: password))) {
            case .ok(let ok): return try ok.body.json.token
            case .badRequest(let response): throw Self.failure(try response.body.json.message)
            case .unauthorized(let response): throw Self.failure(try response.body.json.message)
            case .forbidden(let response): throw Self.failure(try response.body.json.message)
            case .notFound(let response): throw Self.failure(try response.body.json.message)
            case .tooManyRequests(let response): throw Self.failure(try response.body.json.message)
            case .internalServerError(let response): throw Self.failure(try response.body.json.message)
            case .undocumented(let status, _): throw Self.failure(nil, status: status)
            }
        }
    }

    func signUp(name: String, email: String, password: String) async throws(AppError) -> String {
        try await mappingErrors {
            switch try await client().signUpEmail(body: .json(.init(name: name, email: email, password: password))) {
            case .ok(let ok):
                guard let token = try ok.body.json.token, !token.isEmpty else {
                    throw AppError.unexpected(status: 200, detail: "The server did not return a session token.")
                }
                return token
            case .badRequest(let response): throw Self.failure(try response.body.json.message)
            case .unauthorized(let response): throw Self.failure(try response.body.json.message)
            case .forbidden(let response): throw Self.failure(try response.body.json.message)
            case .notFound(let response): throw Self.failure(try response.body.json.message)
            case .unprocessableContent(let response): throw Self.failure(try response.body.json.message)
            case .tooManyRequests(let response): throw Self.failure(try response.body.json.message)
            case .internalServerError(let response): throw Self.failure(try response.body.json.message)
            case .undocumented(let status, _): throw Self.failure(nil, status: status)
            }
        }
    }

    func signOut(token: String) async throws(AppError) {
        try await mappingErrors {
            let response = try await client(token: token).signOut(body: .json(.init()))
            guard case .ok = response else {
                throw AppError.unexpected(status: nil, detail: "Sign-out failed")
            }
        }
    }

    static func failure(_ message: String?, status: Int? = nil) -> AppError {
        if let message, !message.isEmpty { return .authFailed(message) }
        return .authFailed(status.map { "Sign-in failed (HTTP \($0))." } ?? "Sign-in failed.")
    }
}

private struct ServerDateTranscoder: DateTranscoder {
    func encode(_ date: Date) throws -> String {
        Date.ISO8601FormatStyle(includingFractionalSeconds: true).format(date)
    }

    func decode(_ string: String) throws -> Date {
        try Timestamp.parse(string)
    }
}
