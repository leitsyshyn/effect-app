import Foundation

enum ConflictNaming {
    static func nextName(after name: String) -> String {
        let ext = extensionSuffix(of: name)
        let base = String(name.dropLast(ext.count))
        let (stem, number) = splitCounter(base)
        return "\(stem) (\(number + 1))\(ext)"
    }

    static func keepBothName(for name: String, taken: Set<String>) -> String {
        let takenKeys = Set(taken.map(key))
        var candidate = nextName(after: name)
        while takenKeys.contains(key(candidate)) {
            candidate = nextName(after: candidate)
        }
        return candidate
    }

    private static func key(_ name: String) -> String {
        name.precomposedStringWithCanonicalMapping.lowercased()
    }

    static func extensionSuffix(of name: String) -> String {
        guard let dot = name.lastIndex(of: "."), dot != name.startIndex else { return "" }
        return String(name[dot...])
    }

    private static func splitCounter(_ base: String) -> (String, Int) {
        guard base.hasSuffix(")"), let open = base.lastIndex(of: "(") else { return (base, 0) }
        let digits = base[base.index(after: open)..<base.index(before: base.endIndex)]
        guard !digits.isEmpty, digits.allSatisfy(\.isASCIIDigit), let number = Int(digits) else {
            return (base, 0)
        }
        let stem = base[..<open]
        guard stem.hasSuffix(" ") else { return (base, 0) }
        return (String(stem.dropLast()), number)
    }
}

private extension Character {
    var isASCIIDigit: Bool { isASCII && isNumber }
}
