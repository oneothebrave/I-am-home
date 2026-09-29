import Foundation

// Checks the pinned legacy backend BEFORE it can replace a damaged manifest with
// an empty dictionary, and verifies its disk result AFTER it reports completion.
enum GuardianStorageIntegrity {
    enum IntegrityError: Error { case damaged, mismatch, ambiguous, invalidRequest }

    struct Access {
        enum Operation: String { case read, write, remove, deletion }
        enum Phase: String { case before, after, failed }
        let operation: Operation
        let phase: Phase
        let value: String?

        init(_ dictionary: [String: Any]) throws {
            guard Set(dictionary.keys) == Set(["operation", "phase", "value"]),
                  let operation = (dictionary["operation"] as? String).flatMap(Operation.init(rawValue:)),
                  let phase = (dictionary["phase"] as? String).flatMap(Phase.init(rawValue:)),
                  dictionary["value"] is String || dictionary["value"] is NSNull else {
                throw IntegrityError.invalidRequest
            }
            let value = dictionary["value"] as? String
            if phase != .after && value != nil { throw IntegrityError.invalidRequest }
            if phase == .after && [.write, .deletion].contains(operation) && value == nil {
                throw IntegrityError.invalidRequest
            }
            if operation == .remove && value != nil { throw IntegrityError.invalidRequest }
            self.operation = operation; self.phase = phase; self.value = value
        }
    }

    private struct Store { let exists: Bool; let value: String? }
    private struct Receipt: Codable { let version: Int; let hasValue: Bool }
    private static let manager = FileManager.default

    static func check(_ access: Access, deletionAuthorized: Bool) throws {
        guard let bundleID = Bundle.main.bundleIdentifier else { throw IntegrityError.invalidRequest }
        let support = try manager.url(for: .applicationSupportDirectory, in: .userDomainMask,
                                      appropriateFor: nil, create: true)
        let documents = try manager.url(for: .documentDirectory, in: .userDomainMask,
                                        appropriateFor: nil, create: false)
        try check(access, deletionAuthorized: deletionAuthorized, support: support,
                  documents: documents, bundleID: bundleID)
    }

    static func check(_ access: Access, deletionAuthorized: Bool,
                      support: URL, documents: URL, bundleID: String) throws {
        guard access.operation != .deletion || deletionAuthorized else { throw IntegrityError.invalidRequest }
        try GuardianStorageProtection.protectAsyncStorage(applicationSupport: support,
            documents: documents, bundleID: bundleID)
        let deletionRepair = access.operation == .deletion && access.phase != .after
        let currentURL = support.appendingPathComponent(bundleID).appendingPathComponent("RCTAsyncLocalStorage_V1")
        let current = try inspect(currentURL, allowDamagedValue: deletionRepair)
        let legacy = try GuardianStorageProtection.legacyDirectoryNames.map {
            try inspect(documents.appendingPathComponent($0), allowDamagedValue: access.operation == .deletion)
        }.filter(\.exists)
        let receiptURL = support.appendingPathComponent("GuardianStorageIntegrity/receipt-v1.json")
        let receipt = try readReceipt(receiptURL, allowMalformed: access.operation == .deletion)
        let value: String?
        if current.exists {
            value = current.value
            // An empty pre-created destination prevents the library's old-directory copy.
            if access.phase == .before && !deletionRepair && current.value == nil &&
                legacy.contains(where: { $0.value != nil }) { throw IntegrityError.ambiguous }
        } else {
            if access.phase == .after && access.value != nil { throw IntegrityError.mismatch }
            // Do not guess which conflicting old copy the library will keep based on
            // modification dates (which can be absent, copied or changed by the clock).
            if !deletionRepair, let first = legacy.first,
               legacy.contains(where: { $0.value != first.value }) { throw IntegrityError.ambiguous }
            value = legacy.first?.value
        }
        let removing = access.operation == .remove && access.phase == .after
        if receipt?.hasValue == true && value == nil && !deletionRepair && !removing {
            throw IntegrityError.damaged
        }
        if access.phase == .after {
            // Compare exact strings, not dictionaries: a cached/truncated/library-null
            // value must not silently replace what the disk actually contains.
            guard current.value.map({ Data($0.utf8) }) == access.value.map({ Data($0.utf8) }) else {
                throw IntegrityError.mismatch
            }
            if access.operation == .deletion {
                // The journal may switch a large external value to an inline value.
                // Remove only its stale external file, after the new journal is verified.
                try removeInlineOrphan(currentURL)
            }
            try writeReceipt(Receipt(version: 1, hasValue: current.value != nil), to: receiptURL, previous: receipt)
        } else if access.phase == .before && value != nil && !deletionRepair {
            // Remember observed data before letting the library perform migration.
            try writeReceipt(Receipt(version: 1, hasValue: true), to: receiptURL, previous: receipt)
        }
    }

    private static func inspect(_ directory: URL, allowDamagedValue: Bool) throws -> Store {
        guard let attributes = try GuardianStorageProtection.checkedAttributes(directory) else {
            return Store(exists: false, value: nil)
        }
        guard attributes[.type] as? FileAttributeType == .typeDirectory else { throw IntegrityError.damaged }
        let manifestURL = directory.appendingPathComponent("manifest.json")
        guard try GuardianStorageProtection.checkedAttributes(manifestURL) != nil else {
            // Truly empty directories are possible after interrupted first setup.
            // A missing manifest alongside ANY files is not a new installation.
            guard try manager.contentsOfDirectory(atPath: directory.path).isEmpty else { throw IntegrityError.damaged }
            return Store(exists: true, value: nil)
        }
        let manifest = try readManifest(manifestURL)
        let raw = manifest[GuardianStorageProtection.guardianKey]
        let externalURL = directory.appendingPathComponent(GuardianStorageProtection.guardianFilename)
        let external = try GuardianStorageProtection.checkedAttributes(externalURL)
        guard let raw else {
            if external != nil && !allowDamagedValue { throw IntegrityError.damaged }
            return Store(exists: true, value: nil)
        }
        if allowDamagedValue { return Store(exists: true, value: raw as? String) }
        let value: String
        if let inline = raw as? String { value = inline }
        else {
            guard external?[.type] as? FileAttributeType == .typeRegular else { throw IntegrityError.damaged }
            let bytes = try Data(contentsOf: externalURL)
            guard let decoded = String(data: bytes, encoding: .utf8) else { throw IntegrityError.damaged }
            value = decoded
        }
        guard let data = value.data(using: .utf8),
              (try? JSONSerialization.jsonObject(with: data)) is [String: Any] else { throw IntegrityError.damaged }
        return Store(exists: true, value: value)
    }

    private static func readManifest(_ url: URL) throws -> [String: Any] {
        guard try GuardianStorageProtection.checkedAttributes(url)?[.type] as? FileAttributeType == .typeRegular
        else { throw IntegrityError.damaged }
        let data = try Data(contentsOf: url)
        guard let manifest = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              manifest.values.allSatisfy({ $0 is String || $0 is NSNull }) else { throw IntegrityError.damaged }
        return manifest
    }

    private static func readReceipt(_ url: URL, allowMalformed: Bool) throws -> Receipt? {
        guard try GuardianStorageProtection.checkedAttributes(url) != nil else { return nil }
        try GuardianStorageProtection.prepareDirectory(url.deletingLastPathComponent())
        try GuardianStorageProtection.protectFile(url)
        let data = try Data(contentsOf: url)
        guard let receipt = try? JSONDecoder().decode(Receipt.self, from: data), receipt.version == 1 else {
            if allowMalformed { return nil }
            throw IntegrityError.damaged
        }
        return receipt
    }

    private static func writeReceipt(_ receipt: Receipt, to url: URL, previous: Receipt?) throws {
        if previous?.hasValue == receipt.hasValue { return }
        try GuardianStorageProtection.prepareDirectory(url.deletingLastPathComponent())
        let data = try JSONEncoder().encode(receipt)
        try data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        try GuardianStorageProtection.protectFile(url)
    }

    private static func removeInlineOrphan(_ directory: URL) throws {
        let manifest = try readManifest(directory.appendingPathComponent("manifest.json"))
        if manifest[GuardianStorageProtection.guardianKey] is String {
            let file = directory.appendingPathComponent(GuardianStorageProtection.guardianFilename)
            if try GuardianStorageProtection.checkedAttributes(file) != nil {
                try GuardianStorageProtection.protectFile(file)
                try manager.removeItem(at: file)
            }
        }
    }
}
