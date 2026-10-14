import Foundation
import HTTPTypes
import OpenAPIRuntime
import Testing
@testable import EffectDrive

@Suite("Error mapping")
struct ErrorMappingTests {
    func thrownError(_ operation: () async throws -> Void) async -> AppError? {
        do {
            try await operation()
            return nil
        } catch {
            #expect(error is AppError, "Expected an AppError, got \(error)")
            return error as? AppError
        }
    }

    @Test("409 NameConflict on a create-only upload asks to replace, keep both or skip")
    func uploadNameConflict() async throws {
        let transport = StubTransport(status: .conflict, json: #"{"_tag":"NameConflict","parentId":{"_tag":"None"},"name":"report.txt"}"#)
        let file = try temporaryFile()
        let error = await thrownError {
            _ = try await Fixtures.drive(transport).upload(fileURL: file, name: "report.txt", parentId: nil)
        }
        #expect(error == .nameConflict(name: "report.txt"))
        #expect(error?.action == .resolveNameConflict)
        #expect(error?.message == "“report.txt” already exists here")
    }

    @Test("412 RevisionMismatch refreshes the listing and says someone else changed it")
    func revisionMismatch() async {
        let transport = StubTransport(
            status: .preconditionFailed,
            json: #"{"_tag":"RevisionMismatch","id":"3e9364bc-7d25-4214-9389-0e5b3aac40db","expected":1,"actual":2}"#
        )
        let item = Fixtures.item("a.txt", id: "3e9364bc-7d25-4214-9389-0e5b3aac40db")
        let error = await thrownError { _ = try await Fixtures.drive(transport).rename(item, to: "b.txt") }
        #expect(error == .revisionMismatch)
        #expect(error?.action == .refresh)
        #expect(error?.message == "Changed elsewhere in the meantime. Try again")
    }

    @Test("412 RevisionMismatch from a replacing upload maps the same way")
    func uploadRevisionMismatch() async throws {
        let transport = StubTransport(
            status: .preconditionFailed,
            json: #"{"_tag":"RevisionMismatch","id":"3e9364bc-7d25-4214-9389-0e5b3aac40db","expected":1,"actual":2}"#
        )
        let file = try temporaryFile()
        let error = await thrownError {
            _ = try await Fixtures.drive(transport).upload(fileURL: file, name: "a.txt", parentId: nil, expectedRevision: 1)
        }
        #expect(error == .revisionMismatch)
    }

    @Test("404 NodeNotFound refreshes the listing")
    func nodeNotFound() async {
        let transport = StubTransport(status: .notFound, json: #"{"_tag":"NodeNotFound","id":"3e9364bc-7d25-4214-9389-0e5b3aac40db"}"#)
        let error = await thrownError { try await Fixtures.drive(transport).delete(Fixtures.item("gone.txt")) }
        #expect(error == .nodeNotFound)
        #expect(error?.action == .refresh)
        #expect(error?.message == "This item no longer exists")
    }

    @Test("401 from the drive server signs the user out", arguments: ["listFolder", "upload", "me"])
    func unauthorizedSignsOut(operation: String) async throws {
        let transport = StubTransport(status: .unauthorized)
        let drive = Fixtures.drive(transport)
        let file = try temporaryFile()
        let error = await thrownError {
            switch operation {
            case "listFolder": _ = try await drive.listFolder(parentId: nil)
            case "upload": _ = try await drive.upload(fileURL: file, name: "a.txt", parentId: nil)
            default: _ = try await drive.currentUser()
            }
        }
        #expect(error == .unauthorized)
        #expect(error?.action == .signOut)
    }

    @Test("409 NameConflict on rename or new folder is a plain message")
    func folderNameConflict() async {
        let transport = StubTransport(status: .conflict, json: #"{"_tag":"NameConflict","parentId":{"_tag":"None"},"name":"Photos"}"#)
        let error = await thrownError { _ = try await Fixtures.drive(transport).createFolder(name: "Photos", parentId: nil) }
        #expect(error == .nameConflict(name: "Photos"))
    }

    @Test("The bearer token is sent on JSON calls and on the multipart upload")
    func sendsBearerToken() async throws {
        let transport = StubTransport { request, _, operationID in
            #expect(request.headerFields[.authorization] == "Bearer session-token", "\(operationID)")
            return operationID == "drive.uploadFile"
                ? StubTransport.response(.ok, json: Fixtures.nodeJSON())
                : StubTransport.response(.ok, json: #"{"path":[],"nodes":[\#(Fixtures.nodeJSON())],"types":[]}"#)
        }
        let drive = Fixtures.drive(transport)
        let listing = try await drive.listFolder(parentId: nil)
        #expect(listing.nodes.map(\.name) == ["a.txt"])
        let uploaded = try await drive.upload(fileURL: try temporaryFile(), name: "a.txt", parentId: nil)
        #expect(uploaded.contentType == "text/plain")
        #expect(transport.requests.count == 2)
    }

    @Test("Server unreachable is a network error, not a sign-out")
    func serverUnreachable() async {
        let error = await thrownError { _ = try await Fixtures.drive(StubTransport.unreachable()).listFolder(parentId: nil) }
        guard case .network = error else {
            Issue.record("Expected .network, got \(String(describing: error))")
            return
        }
        #expect(error?.message == "Couldn't reach the server")
        #expect(error?.action == ErrorAction.none)
    }

    @Test("Daemon not listening shows how to start it")
    func daemonUnreachable() async throws {
        let daemon = SyncDaemonService(daemonURL: Fixtures.daemon, transport: StubTransport.unreachable(), controlToken: try Fixtures.controlTokenFile())
        let error = await thrownError { _ = try await daemon.status() }
        #expect(error == .daemonUnreachable)
        #expect(error?.action == .showDaemonHint)
        #expect(error?.message == "Sync daemon not running — start it with `bun run dev:sync`")
    }

    @Test("A missing control-token file means the daemon was never started; no request is sent")
    func missingControlToken() async {
        let transport = StubTransport(status: .ok, json: "{}")
        let missing = ControlTokenFile(url: URL(fileURLWithPath: "/nonexistent/\(UUID().uuidString)/control-token"))
        let daemon = SyncDaemonService(daemonURL: Fixtures.daemon, transport: transport, controlToken: missing)
        let error = await thrownError { try await daemon.syncNow() }
        #expect(error == .daemonUnreachable)
        #expect(transport.requests.isEmpty)
    }

    @Test("Daemon calls carry the control token, not the user's session token")
    func controlTokenHeader() async throws {
        let transport = StubTransport { request, _, _ in
            #expect(request.headerFields[.authorization] == "Bearer control-secret")
            return (HTTPResponse(status: .noContent), nil)
        }
        let daemon = SyncDaemonService(daemonURL: Fixtures.daemon, transport: transport, controlToken: try Fixtures.controlTokenFile())
        try await daemon.pause()
        #expect(transport.requests.first?.operationID == "sync.pause")
    }

    @Test("PUT /session rejected with SignInFailed means the session is gone: sign out")
    func daemonSignInFailed() async throws {
        let transport = StubTransport(status: .unauthorized, json: #"{"_tag":"SignInFailed","reason":"Unauthorized"}"#)
        let daemon = SyncDaemonService(daemonURL: Fixtures.daemon, transport: transport, controlToken: try Fixtures.controlTokenFile())
        let error = await thrownError { try await daemon.signIn(serverURL: Fixtures.server, token: "expired") }
        #expect(error == .unauthorized)
        #expect(error?.action == .signOut)
    }

    @Test("PUT /session failing because the daemon can't reach the server is not a sign-out")
    func daemonCannotReachServer() async throws {
        let transport = StubTransport(status: .serviceUnavailable, json: #"{"_tag":"ServerUnreachable","reason":"The server cannot be reached"}"#)
        let daemon = SyncDaemonService(daemonURL: Fixtures.daemon, transport: transport, controlToken: try Fixtures.controlTokenFile())
        let error = await thrownError { try await daemon.signIn(serverURL: Fixtures.server, token: "valid") }
        #expect(error?.action == ErrorAction.none)
        if case .network = error {} else { Issue.record("expected a network error, got \(String(describing: error))") }
    }

    @Test("A wrong control token is a daemon problem, not a sign-out")
    func wrongControlToken() async throws {
        let transport = StubTransport(status: .unauthorized, json: #"{"_tag":"Unauthorized"}"#)
        let daemon = SyncDaemonService(daemonURL: Fixtures.daemon, transport: transport, controlToken: try Fixtures.controlTokenFile())
        let error = await thrownError { _ = try await daemon.issues() }
        #expect(error == .daemonRejectedControlToken)
        #expect(error?.action == .showDaemonHint)
    }

    @Test("Linking errors: 400 InvalidFolder and 409 NotSignedIn")
    func linkErrors() async throws {
        let invalid = StubTransport(status: .badRequest, json: #"{"_tag":"InvalidFolder","path":"/x","reason":"Folder does not exist"}"#)
        let tokenFile = try Fixtures.controlTokenFile()
        let invalidError = await thrownError {
            try await SyncDaemonService(daemonURL: Fixtures.daemon, transport: invalid, controlToken: tokenFile).link(localPath: "/x")
        }
        #expect(invalidError == .invalidFolder(reason: "Folder does not exist"))
        #expect(invalidError?.message == "Can't link this folder: Folder does not exist")

        let notSignedIn = StubTransport(status: .conflict, json: #"{"_tag":"NotSignedIn"}"#)
        let notSignedInError = await thrownError {
            try await SyncDaemonService(daemonURL: Fixtures.daemon, transport: notSignedIn, controlToken: tokenFile).link(localPath: "/x")
        }
        #expect(notSignedInError == .daemonNotSignedIn)
    }

    @Test("better-auth's error message is shown on sign-in failure")
    func signInFailure() async {
        let transport = StubTransport(status: .unauthorized, json: #"{"message":"Invalid email or password","code":"INVALID_EMAIL_OR_PASSWORD"}"#)
        let auth = AuthService(serverURL: Fixtures.server, transport: transport)
        let error = await thrownError { _ = try await auth.signIn(email: "a@b.c", password: "nope") }
        #expect(error == .authFailed("Invalid email or password"))
    }

    @Test("Sign-in posts to better-auth under /api/auth and returns the token from the body")
    func signInToken() async throws {
        let transport = RecordingTransport { _, _ in
            StubTransport.response(.ok, json: #"{"redirect":false,"token":"abc","user":\#(SessionTests.userJSON)}"#)
        }
        let token = try await AuthService(serverURL: Fixtures.server, transport: transport).signIn(email: "a@b.c", password: "pw")
        #expect(token == "abc")
        let sent = try #require(transport.requests.first)
        #expect(sent.operationID == "signInEmail")
        #expect(sent.baseURL == Fixtures.server.appending(path: "api/auth"))
        #expect(sent.request.path == "/sign-in/email")
        let body = try #require(try JSONSerialization.jsonObject(with: sent.body) as? [String: String])
        #expect(body == ["email": "a@b.c", "password": "pw"])
    }

    @Test("Sign-up returns the token from the body; 422 shows better-auth's message")
    func signUp() async throws {
        let ok = StubTransport(status: .ok, json: #"{"token":"new","user":\#(SessionTests.userJSON)}"#)
        let token = try await AuthService(serverURL: Fixtures.server, transport: ok).signUp(name: "Ann", email: "a@b.c", password: "password123")
        #expect(token == "new")

        let taken = StubTransport(status: .unprocessableContent, json: #"{"message":"User already exists. Use another email.","code":"USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL"}"#)
        let error = await thrownError {
            _ = try await AuthService(serverURL: Fixtures.server, transport: taken).signUp(name: "Ann", email: "a@b.c", password: "password123")
        }
        #expect(error == .authFailed("User already exists. Use another email."))
    }

    @Test("Sign-out sends the session token as a bearer token")
    func signOutSendsToken() async throws {
        let transport = StubTransport { request, _, _ in
            #expect(request.headerFields[.authorization] == "Bearer tok")
            return StubTransport.response(.ok, json: #"{"success":true}"#)
        }
        try await AuthService(serverURL: Fixtures.server, transport: transport).signOut(token: "tok")
        #expect(transport.requests.map(\.operationID) == ["signOut"])
    }

    private func temporaryFile(_ contents: String = "hello\n") throws -> URL {
        let url = FileManager.default.temporaryDirectory.appending(path: "upload-\(UUID().uuidString).txt")
        try contents.write(to: url, atomically: true, encoding: .utf8)
        return url
    }
}
