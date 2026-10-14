import Foundation
import HTTPTypes
import OpenAPIRuntime
import OpenAPIURLSession

struct Endpoints: Sendable {
    var server: URL
    var daemon: URL

    static func fromEnvironment(_ environment: [String: String] = ProcessInfo.processInfo.environment) -> Endpoints {
        Endpoints(
            server: environment["DRIVE_SERVER_URL"].flatMap(URL.init(string:)) ?? URL(string: "http://localhost:3000")!,
            daemon: environment["SYNC_DAEMON_URL"].flatMap(URL.init(string:)) ?? URL(string: "http://127.0.0.1:47821")!
        )
    }
}

enum Transports {
    static func urlSession() -> any ClientTransport {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpCookieStorage = nil
        configuration.httpShouldSetCookies = false
        configuration.urlCache = nil
        configuration.timeoutIntervalForRequest = 120
        return URLSessionTransport(configuration: .init(session: URLSession(configuration: configuration)))
    }
}

struct BearerTokenMiddleware: ClientMiddleware {
    let token: @Sendable () throws -> String?

    func intercept(
        _ request: HTTPRequest,
        body: HTTPBody?,
        baseURL: URL,
        operationID: String,
        next: @Sendable (HTTPRequest, HTTPBody?, URL) async throws -> (HTTPResponse, HTTPBody?)
    ) async throws -> (HTTPResponse, HTTPBody?) {
        var request = request
        if let token = try token() {
            request.headerFields[.authorization] = "Bearer \(token)"
        }
        return try await next(request, body, baseURL)
    }
}

enum ErrorMapping {
    static func transportError(_ error: any Error, daemon: Bool) -> AppError {
        if let error = error as? AppError { return error }
        if let error = error as? ClientError {
            return transportError(error.underlyingError, daemon: daemon)
        }
        if let error = error as? URLError {
            if daemon, connectionFailureCodes.contains(error.code) { return .daemonUnreachable }
            return .network(error.localizedDescription)
        }
        if error is CancellationError { return .unexpected(status: nil, detail: "Cancelled") }
        return .unexpected(status: nil, detail: String(describing: error))
    }

    private static let connectionFailureCodes: Set<URLError.Code> = [
        .cannotConnectToHost, .cannotFindHost, .networkConnectionLost, .timedOut, .notConnectedToInternet,
    ]
}

func mappingErrors<T>(daemon: Bool = false, _ operation: () async throws -> T) async throws(AppError) -> T {
    do {
        return try await operation()
    } catch {
        throw ErrorMapping.transportError(error, daemon: daemon)
    }
}

extension HTTPBody {
    convenience init(contentsOfFileAt url: URL) {
        self.init(FileChunks(url: url), length: .unknown, iterationBehavior: .multiple)
    }
}

private struct FileChunks: AsyncSequence, Sendable {
    typealias Element = ArraySlice<UInt8>

    let url: URL
    var chunkSize = 256 * 1024

    func makeAsyncIterator() -> Iterator { Iterator(url: url, chunkSize: chunkSize) }

    struct Iterator: AsyncIteratorProtocol {
        let url: URL
        let chunkSize: Int
        var handle: FileHandle?
        var finished = false

        mutating func next() async throws -> ArraySlice<UInt8>? {
            try Task.checkCancellation()
            guard !finished else { return nil }
            if handle == nil { handle = try FileHandle(forReadingFrom: url) }
            if let data = try handle?.read(upToCount: chunkSize), !data.isEmpty {
                return ArraySlice(data)
            }
            try handle?.close()
            handle = nil
            finished = true
            return nil
        }
    }
}

enum ServerSentEvents {
    static func decode<T: Decodable & Sendable & Hashable>(
        _ type: T.Type,
        from body: HTTPBody,
        daemon: Bool = false
    ) -> AsyncThrowingStream<T, any Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    for try await event in body.asDecodedServerSentEventsWithJSONData(of: T.self) {
                        if let data = event.data { continuation.yield(data) }
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: ErrorMapping.transportError(error, daemon: daemon))
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }
}
