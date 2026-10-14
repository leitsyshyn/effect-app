import Testing
@testable import EffectDrive

@Suite("Keep Both naming")
struct ConflictNamingTests {
    @Test("Appends or increments a counter before the extension", arguments: [
        ("report.txt", "report (1).txt"),
        ("report (1).txt", "report (2).txt"),
        ("report (9).txt", "report (10).txt"),
        ("Makefile", "Makefile (1)"),
        ("Makefile (3)", "Makefile (4)"),
        ("archive.tar.gz", "archive.tar (1).gz"),
        (".bashrc", ".bashrc (1)"),
        ("PHOTO.JPG", "PHOTO (1).JPG"),
        ("notes(1).txt", "notes(1) (1).txt"),
        ("draft (v2).txt", "draft (v2) (1).txt"),
    ])
    func nextName(name: String, expected: String) {
        #expect(ConflictNaming.nextName(after: name) == expected)
    }

    @Test("Skips names that are already taken")
    func skipsTakenNames() {
        let taken: Set = ["report.txt", "report (1).txt", "report (2).txt"]
        #expect(ConflictNaming.keepBothName(for: "report.txt", taken: taken) == "report (3).txt")
    }
}
