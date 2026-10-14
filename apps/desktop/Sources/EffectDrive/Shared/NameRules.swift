import Foundation

enum NameRules {
    static let maxLength = 255

    static func problem(_ name: String) -> String? {
        let name = name.precomposedStringWithCanonicalMapping
        if name.isEmpty { return "Name must not be empty" }
        if name.utf16.count > maxLength { return "Name must be at most \(maxLength) characters" }
        if name == "." || name == ".." { return "Name must not be '.' or '..'" }
        if name.contains(where: { $0 == "/" || $0 == "\\" || $0 == "\0" }) {
            return "Name must not contain '/', '\\' or NUL"
        }
        if name.trimmingCharacters(in: .whitespacesAndNewlines) != name {
            return "Name must not start or end with whitespace"
        }
        return nil
    }
}
