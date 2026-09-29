import Foundation
import CryptoKit

// Ordinary access only upgrades metadata, never rewrites or logs user data.
// Legacy key removal is a separate operation, only for a confirmed full-data erase.
// The AsyncStorage paths below are audited against the pinned 3.1.1 legacy API.
enum GuardianStorageProtection {
    private static let manager = FileManager.default
    private static let protection = FileProtectionType.completeUntilFirstUserAuthentication
    static let legacyDirectoryNames = ["RCTAsyncLocalStorage_V1", "RNCAsyncLocalStorage_V1", "RCTAsyncLocalStorage"]
    static let guardianKey = "@daojia_shuo_yisheng/guardian_state_v1"
    static var guardianFilename: String {
        Insecure.MD5.hash(data: Data(guardianKey.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    // Injectable roots for isolated XCTest fixtures, never supplied by JavaScript.
    static func protectAsyncStorage(applicationSupport: URL, documents: URL, bundleID: String) throws {
        guard bundleID.range(of: "^[A-Za-z0-9][A-Za-z0-9.-]*$", options: .regularExpression) != nil,
              !bundleID.contains("..") else { throw ProtectionError.invalidPath }
        let parent = applicationSupport.appendingPathComponent(bundleID, isDirectory: true)
        try prepareDirectory(parent)
        // Do not pre-create the final directory. The library only copies a legacy
        // Documents store when the destination is absent; an empty directory loses that migration.
        try protectStorageDirectoryIfPresent(parent.appendingPathComponent("RCTAsyncLocalStorage_V1", isDirectory: true))
        for name in legacyDirectoryNames {
            try protectStorageDirectoryIfPresent(documents.appendingPathComponent(name, isDirectory: true))
        }
    }

    static func clearLegacyGuardianData() throws {
        let documents = try manager.url(for: .documentDirectory, in: .userDomainMask,
                                        appropriateFor: nil, create: false)
        try clearLegacyGuardianData(documents: documents)
    }

    // AsyncStorage's Documents -> Application Support migration leaves its source
    // behind. Removing a key via the library only affects the CURRENT store.
    // Called after the native deletion tombstone and empty JS journal are durable.
    static func clearLegacyGuardianData(documents: URL) throws {
        // Compatibility filename, NOT encryption or a security hash. Matches RCTMD5Hash.
        let filename = guardianFilename
        for name in legacyDirectoryNames {
            let directory = documents.appendingPathComponent(name, isDirectory: true)
            try protectStorageDirectoryIfPresent(directory)
            guard try attributesIfPresent(directory) != nil else { continue }
            let manifestURL = directory.appendingPathComponent("manifest.json")
            if try attributesIfPresent(manifestURL) != nil {
                try protectFile(manifestURL)
                guard var manifest = try JSONSerialization.jsonObject(with: Data(contentsOf: manifestURL)) as? [String: Any]
                else { throw ProtectionError.invalidManifest }
                if manifest.removeValue(forKey: guardianKey) != nil {
                    let data = try JSONSerialization.data(withJSONObject: manifest, options: [.sortedKeys])
                    try data.write(to: manifestURL, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
                    try protectFile(manifestURL)
                }
            }
            // Also remove an orphan left by an interrupted erase. Never touch another
            // key's file or remove a whole legacy directory. A malformed manifest fails closed.
            let valueURL = directory.appendingPathComponent(filename)
            if try attributesIfPresent(valueURL) != nil {
                try protectFile(valueURL)
                try manager.removeItem(at: valueURL)
            }
        }
    }

    private static func protectStorageDirectoryIfPresent(_ url: URL) throws {
        try rejectLinkedPath(url)
        guard let attributes = try attributesIfPresent(url) else { return }
        guard attributes[.type] as? FileAttributeType == .typeDirectory else {
            throw ProtectionError.invalidPath
        }
        try protectExistingTree(url)
    }

    static func prepareDirectory(_ url: URL) throws {
        try rejectLinkedPath(url)
        if let attributes = try attributesIfPresent(url) {
            guard attributes[.type] as? FileAttributeType == .typeDirectory else {
                throw ProtectionError.invalidPath
            }
        } else {
            try manager.createDirectory(at: url, withIntermediateDirectories: true,
                                        attributes: [.protectionKey: protection])
        }
        try protectItem(url)
    }

    static func protectExistingTree(_ url: URL) throws {
        try rejectLinkedPath(url)
        guard let attributes = try attributesIfPresent(url) else { return }
        let type = attributes[.type] as? FileAttributeType
        guard type == .typeRegular || type == .typeDirectory else { throw ProtectionError.invalidPath }
        try protectItem(url)
        if type == .typeDirectory {
            for child in try manager.contentsOfDirectory(at: url, includingPropertiesForKeys: nil) {
                try protectExistingTree(child)
            }
        }
    }

    static func protectFile(_ url: URL) throws {
        try rejectLinkedPath(url)
        guard try attributesIfPresent(url)?[.type] as? FileAttributeType == .typeRegular else {
            throw ProtectionError.invalidPath
        }
        try protectItem(url)
    }

    private static func protectItem(_ url: URL) throws {
        try manager.setAttributes([.protectionKey: protection], ofItemAtPath: url.path)
        var target = url
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try target.setResourceValues(values)
        // Fresh URL avoids resource-value caching. Treat a failed/ignored setting as failure.
        let check = URL(fileURLWithPath: url.path)
        let attributes = try manager.attributesOfItem(atPath: check.path)
        let actualProtection = (attributes[.protectionKey] as? FileProtectionType)?.rawValue ??
            (attributes[.protectionKey] as? String)
        guard actualProtection == protection.rawValue,
              try check.resourceValues(forKeys: [.isExcludedFromBackupKey]).isExcludedFromBackup == true
        else { throw ProtectionError.notApplied }
    }

    private static func attributesIfPresent(_ url: URL) throws -> [FileAttributeKey: Any]? {
        do { return try manager.attributesOfItem(atPath: url.path) }
        catch {
            let failure = error as NSError
            if failure.domain == NSCocoaErrorDomain &&
                [NSFileNoSuchFileError, NSFileReadNoSuchFileError].contains(failure.code) { return nil }
            throw error
        }
    }

    static func checkedAttributes(_ url: URL) throws -> [FileAttributeKey: Any]? {
        try rejectLinkedPath(url)
        return try attributesIfPresent(url)
    }

    private static func rejectLinkedPath(_ url: URL) throws {
        // Stay inside the application container. Do not stat system ancestors:
        // iOS sandbox rules can deny those reads even for a valid application URL.
        let home = URL(fileURLWithPath: NSHomeDirectory(), isDirectory: true).standardizedFileURL
        let resolvedHome = home.resolvingSymlinksInPath().path
        guard url.resolvingSymlinksInPath().path.hasPrefix(resolvedHome + "/") else {
            throw ProtectionError.invalidPath
        }
        var current = url.standardizedFileURL
        while current.path != "/" {
            if current.path == home.path || current.path == resolvedHome { return }
            if let attributes = try attributesIfPresent(current),
               attributes[.type] as? FileAttributeType == .typeSymbolicLink {
                throw ProtectionError.invalidPath
            }
            current = current.deletingLastPathComponent()
        }
        throw ProtectionError.invalidPath
    }

    private enum ProtectionError: Error {
        case invalidPath
        case notApplied
        case invalidManifest
    }
}
