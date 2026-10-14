import Foundation
import HTTPTypes
import OpenAPIRuntime
import Testing
@testable import EffectDrive

@MainActor
@Suite("Session")
struct SessionTests {
    nonisolated static let userJSON = #"{"id":"u1","name":"Ann","email":"ann@example.com","emailVerified":false,"image":null,"createdAt":"2026-10-05T22:03:04.631Z","updatedAt":"2026-10-05T22:03:04.631Z"}"#

    func makeTransport() -> StubTransport {
        StubTransport { _, _, operationID in
            switch operationID {
            case "signInEmail":
                return StubTransport.response(.ok, json: #"{"redirect":false,"token":"tok","user":\#(Self.userJSON)}"#)
            case "signOut":
                return StubTransport.response(.ok, json: #"{"success":true}"#)
            case "user.me":
                return StubTransport.response(.ok, json: Self.userJSON)
            case "drive.listFolder":
                return StubTransport.response(.ok, json: #"{"path":[],"nodes":[\#(Fixtures.nodeJSON())],"types":[{"type":"txt","count":1}]}"#)
            case "session.signOut", "session.signIn":
                return (HTTPResponse(status: operationID == "session.signOut" ? .noContent : .ok), nil)
            default:
                throw URLError(.cannotConnectToHost)
            }
        }
    }

    func makeModel(_ transport: StubTransport, tokens: InMemoryTokenStore) throws -> AppModel {
        AppModel(environment: AppEnvironment(
            endpoints: Endpoints(server: Fixtures.server, daemon: Fixtures.daemon),
            transport: transport,
            tokenStore: tokens,
            controlToken: try Fixtures.controlTokenFile(),
            defaults: UserDefaults(suiteName: "EffectDriveTests.\(UUID().uuidString)")!
        ))
    }

    @Test("Sign-out clears the token, the drive data and the daemon session")
    func signOutClearsEverything() async throws {
        let transport = makeTransport()
        let tokens = InMemoryTokenStore()
        let model = try makeModel(transport, tokens: tokens)

        try await model.signIn(email: "ann@example.com", password: "pw")
        #expect(model.phase == .signedIn)
        #expect(model.user?.name == "Ann")
        #expect(tokens.load() == "tok")
        for _ in 0..<100 where model.drive?.nodes.isEmpty != false {
            try await Task.sleep(for: .milliseconds(10))
        }
        #expect(model.drive?.nodes.count == 1)

        await model.signOut()
        #expect(model.phase == .signedOut)
        #expect(model.user == nil)
        #expect(model.drive == nil)
        #expect(model.sync == nil)
        #expect(tokens.load() == nil)
        let operations = transport.requests.map(\.operationID)
        #expect(operations.contains("signOut"))
        #expect(operations.contains("session.signOut"))
    }

    @Test("A saved token that the server rejects returns to the sign-in screen and is deleted")
    func restoreWithExpiredToken() async throws {
        let transport = StubTransport(status: .unauthorized)
        let tokens = InMemoryTokenStore(token: "expired")
        let model = try makeModel(transport, tokens: tokens)
        await model.restore()
        #expect(model.phase == .signedOut)
        #expect(tokens.load() == nil)
    }
}
