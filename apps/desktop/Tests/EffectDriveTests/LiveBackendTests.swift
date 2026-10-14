import Foundation
import OpenAPIRuntime
import Testing
@testable import EffectDrive

@Suite(
    "Live backend",
    .serialized,
    .enabled(if: ProcessInfo.processInfo.environment["EFFECTDRIVE_LIVE_TESTS"] == "1")
)
struct LiveBackendTests {
    let endpoints = Endpoints.fromEnvironment()
    let transport = Transports.urlSession()

    func signUp() async throws -> (token: String, drive: DriveService) {
        let auth = AuthService(serverURL: endpoints.server, transport: transport)
        let suffix = UUID().uuidString.prefix(8)
        let token = try await auth.signUp(name: "Live \(suffix)", email: "live-\(suffix)@example.com", password: "password123")
        return (token, DriveService(serverURL: endpoints.server, transport: transport, token: { token }))
    }

    func temporaryFile(_ name: String, _ data: Data) throws -> URL {
        let directory = FileManager.default.temporaryDirectory.appending(path: "live-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let url = directory.appending(path: name)
        try data.write(to: url)
        return url
    }

    @Test("Drive: folders, upload, conflicts, preview, download, rename, delete, sign-out")
    func driveRoundTrip() async throws {
        let (token, drive) = try await signUp()
        let user = try await drive.currentUser()

        let outer = try await drive.createFolder(name: "Outer", parentId: nil)
        let inner = try await drive.createFolder(name: "Inner", parentId: outer.id)
        let innerListing = try await drive.listFolder(parentId: inner.id)
        #expect(innerListing.path.map(\.name) == ["Outer", "Inner"])

        let big = Data((0..<3_000_000).map { UInt8($0 % 253) })
        let photo = try await drive.upload(fileURL: try temporaryFile("Photo.JPG", big), name: "Photo.JPG", parentId: inner.id)
        #expect(photo.size == big.count)
        #expect(photo.contentType == "image/jpeg")
        #expect(photo.fileType == "jpg")
        #expect(photo.preview == .image)
        #expect(photo.createdBy == user.name)

        let notes = try temporaryFile("notes.txt", Data("first\n".utf8))
        let created = try await drive.upload(fileURL: notes, name: "notes.txt", parentId: inner.id)
        await #expect(throws: AppError.nameConflict(name: "notes.txt")) {
            _ = try await drive.upload(fileURL: notes, name: "notes.txt", parentId: inner.id)
        }
        let second = try temporaryFile("notes.txt", Data("second\n".utf8))
        let replaced = try await drive.upload(fileURL: second, name: "notes.txt", parentId: inner.id, expectedRevision: created.revision)
        #expect(replaced.id == created.id)
        #expect(replaced.revision > created.revision)
        await #expect(throws: AppError.revisionMismatch) {
            _ = try await drive.upload(fileURL: second, name: "notes.txt", parentId: inner.id, expectedRevision: created.revision)
        }
        let taken = Set(try await drive.listFolder(parentId: inner.id).nodes.map(\.name))
        let copyName = ConflictNaming.keepBothName(for: "notes.txt", taken: taken)
        let copy = try await drive.upload(fileURL: notes, name: copyName, parentId: inner.id)
        #expect(copy.name == "notes (1).txt")

        let text = try await drive.previewData(of: replaced, upTo: 1024)
        #expect(String(decoding: text, as: UTF8.self) == "second\n")
        let destination = FileManager.default.temporaryDirectory.appending(path: "download-\(UUID().uuidString).jpg")
        try await drive.download(photo, to: destination)
        #expect(try Data(contentsOf: destination) == big)

        let plus = try await drive.upload(fileURL: notes, name: DriveViewModel.normalized("a+b c\u{0065}\u{0301}.txt"), parentId: inner.id)
        #expect(plus.name == "a+b c\u{00e9}.txt")

        let renamed = try await drive.rename(copy, to: "renamed.txt")
        #expect(renamed.name == "renamed.txt")
        await #expect(throws: AppError.revisionMismatch) { _ = try await drive.rename(copy, to: "again.txt") }
        try await drive.delete(outer)
        await #expect(throws: AppError.nodeNotFound) { _ = try await drive.listFolder(parentId: inner.id) }

        try await AuthService(serverURL: endpoints.server, transport: transport).signOut(token: token)
        await #expect(throws: AppError.unauthorized) { _ = try await drive.currentUser() }
    }

    @Test("Drive: move into a folder, back to the root, and not into itself")
    func move() async throws {
        let (_, drive) = try await signUp()
        let folder = try await drive.createFolder(name: "Target", parentId: nil)
        let inner = try await drive.createFolder(name: "Inner", parentId: folder.id)
        let file = try await drive.upload(fileURL: try temporaryFile("a.txt", Data("a".utf8)), name: "a.txt", parentId: nil)

        let moved = try await drive.move(file, to: folder.id)
        #expect(moved.parentId == folder.id)
        #expect(try await drive.listFolder(parentId: folder.id).nodes.contains { $0.id == file.id })

        let back = try await drive.move(moved, to: nil)
        #expect(back.parentId == nil)
        #expect(try await drive.listFolder(parentId: nil).nodes.contains { $0.id == file.id })

        await #expect(throws: AppError.revisionMismatch) { _ = try await drive.move(file, to: folder.id) }
        await #expect {
            _ = try await drive.move(folder, to: inner.id)
        } throws: { error in
            if case .invalidMove = error as? AppError { true } else { false }
        }
    }

    @Test("Drive: the server sorts by modification date and filters by .kt and .jpg")
    func sortAndFilter() async throws {
        let (_, drive) = try await signUp()
        let folder = try await drive.createFolder(name: "Mixed", parentId: nil)
        for name in ["Main.kt", "notes.txt", "Photo.JPG"] {
            _ = try await drive.upload(fileURL: try temporaryFile(name, Data(name.utf8)), name: name, parentId: folder.id)
        }
        let listing = try await drive.listFolder(parentId: folder.id, sort: ListingSort(.modified, .forward), filter: ["kt", "jpg"])
        #expect(listing.nodes.map(\.name) == ["Main.kt", "Photo.JPG"])
        #expect(listing.types == [.init(type: "jpg", count: 1), .init(type: "kt", count: 1), .init(type: "txt", count: 1)])
    }

    @Test("Drive: the change stream announces an upload made by another client")
    func liveChanges() async throws {
        let (_, drive) = try await signUp()
        let changes = try await drive.changeCursors()
        var iterator = changes.makeAsyncIterator()
        let first = try await iterator.next()
        #expect(first != nil)

        _ = try await drive.createFolder(name: "From elsewhere", parentId: nil)
        let next = try await iterator.next()
        #expect(next != nil)
        #expect(next?.cursor != first?.cursor)
    }

    @Test("Daemon: status stream, session hand-over, link, pause/resume, unlink, sign-out")
    func daemonControl() async throws {
        let (token, drive) = try await signUp()
        let user = try await drive.currentUser()
        let daemon = SyncDaemonService(daemonURL: endpoints.daemon, transport: transport, controlToken: .fromEnvironment())

        try await daemon.signIn(serverURL: endpoints.server, token: token)
        let updates = try await daemon.statusUpdates()
        var iterator = updates.makeAsyncIterator()
        let first = try #require(try await iterator.next())
        #expect(first.user?.email == user.email)

        let folder = FileManager.default.temporaryDirectory.appending(path: "live-link-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        try "local\n".write(to: folder.appending(path: "local.txt"), atomically: true, encoding: .utf8)

        await #expect(throws: AppError.invalidFolder(reason: "Folder does not exist")) {
            try await daemon.link(localPath: folder.appending(path: "missing").path)
        }
        try await daemon.link(localPath: folder.path)
        try await daemon.syncNow()

        var uploaded = false
        for _ in 0..<50 where !uploaded {
            try await Task.sleep(for: .milliseconds(200))
            uploaded = try await drive.listFolder(parentId: nil).nodes.contains { $0.name == "local.txt" }
        }
        #expect(uploaded)

        try await daemon.pause()
        #expect(try await daemon.status().state == .paused)
        try await daemon.resume()
        _ = try await daemon.pending()
        _ = try await daemon.issues()

        try await daemon.unlink()
        #expect(try await daemon.status().linkedFolder == nil)
        #expect(FileManager.default.fileExists(atPath: folder.appending(path: "local.txt").path))
        try await daemon.signOut()
        #expect(try await daemon.status().state == .signedOut)
    }
}
