import Foundation
import Security

protocol TokenStore: Sendable {
    func load() -> String?
    func save(_ token: String) throws
    func delete()
}

struct KeychainTokenStore: TokenStore {
    var service = "EffectDrive"
    var account = "session-token"

    private var query: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }

    func load() -> String? {
        var query = query
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data
        else { return nil }
        return String(data: data, encoding: .utf8)
    }

    func save(_ token: String) throws {
        delete()
        var item = query
        item[kSecValueData as String] = Data(token.utf8)
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        let status = SecItemAdd(item as CFDictionary, nil)
        guard status == errSecSuccess else {
            let reason = SecCopyErrorMessageString(status, nil) as String? ?? "OSStatus \(status)"
            throw AppError.unexpected(status: nil, detail: "Couldn't save the session in the Keychain: \(reason)")
        }
    }

    func delete() {
        SecItemDelete(query as CFDictionary)
    }
}

final class InMemoryTokenStore: TokenStore, @unchecked Sendable {
    private let lock = NSLock()
    private var token: String?

    init(token: String? = nil) { self.token = token }

    func load() -> String? { lock.withLock { token } }
    func save(_ token: String) throws { lock.withLock { self.token = token } }
    func delete() { lock.withLock { token = nil } }
}
