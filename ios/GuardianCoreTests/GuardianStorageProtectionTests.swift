import XCTest
import Foundation
import CryptoKit

// Requires an iOS XCTest host. These tests are not executed by npm/Windows.
final class GuardianStorageProtectionTests: XCTestCase {
    private let manager = FileManager.default
    private let bundleID = "com.example.storage-test"

    private func fixture(_ body: (URL, URL, URL) throws -> Void) throws {
        let root = manager.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        let support = root.appendingPathComponent("Application Support", isDirectory: true)
        let documents = root.appendingPathComponent("Documents", isDirectory: true)
        try manager.createDirectory(at: support, withIntermediateDirectories: true)
        try manager.createDirectory(at: documents, withIntermediateDirectories: true)
        defer { try? manager.removeItem(at: root) }
        try body(root, support, documents)
    }

    private func assertProtected(_ url: URL, file: StaticString = #filePath, line: UInt = #line) throws {
        let attributes = try manager.attributesOfItem(atPath: url.path)
        let protection = (attributes[.protectionKey] as? FileProtectionType)?.rawValue ??
            (attributes[.protectionKey] as? String)
        XCTAssertEqual(protection, FileProtectionType.completeUntilFirstUserAuthentication.rawValue,
                       file: file, line: line)
        XCTAssertEqual(try URL(fileURLWithPath: url.path).resourceValues(forKeys: [.isExcludedFromBackupKey])
            .isExcludedFromBackup, true, file: file, line: line)
    }

    private func removeProtection(_ url: URL) throws {
        try manager.setAttributes([.protectionKey: FileProtectionType.none], ofItemAtPath: url.path)
        var target = url
        var values = URLResourceValues()
        values.isExcludedFromBackup = false
        try target.setResourceValues(values)
    }

    func testFreshInstallPreparesOnlyParentNotAnEmptyMigrationDestination() throws {
        try fixture { _, support, documents in
            try GuardianStorageProtection.protectAsyncStorage(applicationSupport: support,
                documents: documents, bundleID: bundleID)
            let parent = support.appendingPathComponent(bundleID)
            try assertProtected(parent)
            XCTAssertFalse(manager.fileExists(atPath: parent.appendingPathComponent("RCTAsyncLocalStorage_V1").path))
            XCTAssertTrue(try manager.contentsOfDirectory(atPath: documents.path).isEmpty)
        }
    }

    func testLegacyDirectoriesUpgradeWithoutContentChangesOrBlockingCopyMigration() throws {
        try fixture { _, support, documents in
            let bytes = Data("synthetic legacy contact/history fixture".utf8)
            for name in ["RCTAsyncLocalStorage_V1", "RNCAsyncLocalStorage_V1", "RCTAsyncLocalStorage"] {
                let legacy = documents.appendingPathComponent(name)
                try manager.createDirectory(at: legacy, withIntermediateDirectories: true)
                try bytes.write(to: legacy.appendingPathComponent("manifest.json"))
                try removeProtection(legacy)
                try removeProtection(legacy.appendingPathComponent("manifest.json"))
            }
            try GuardianStorageProtection.protectAsyncStorage(applicationSupport: support,
                documents: documents, bundleID: bundleID)
            let destination = support.appendingPathComponent(bundleID).appendingPathComponent("RCTAsyncLocalStorage_V1")
            XCTAssertFalse(manager.fileExists(atPath: destination.path))
            // Mirrors the library's absent-destination copy, not the library itself.
            try manager.copyItem(at: documents.appendingPathComponent("RCTAsyncLocalStorage_V1"), to: destination)
            try GuardianStorageProtection.protectAsyncStorage(applicationSupport: support,
                documents: documents, bundleID: bundleID)
            try assertProtected(destination.appendingPathComponent("manifest.json"))
            XCTAssertEqual(try Data(contentsOf: destination.appendingPathComponent("manifest.json")), bytes)
            for name in ["RCTAsyncLocalStorage_V1", "RNCAsyncLocalStorage_V1", "RCTAsyncLocalStorage"] {
                let file = documents.appendingPathComponent(name).appendingPathComponent("manifest.json")
                try assertProtected(file)
                XCTAssertEqual(try Data(contentsOf: file), bytes)
            }
        }
    }

    func testExistingInlineExternalAndHiddenFilesAreProtectedIdempotently() throws {
        try fixture { _, support, documents in
            let current = support.appendingPathComponent(bundleID).appendingPathComponent("RCTAsyncLocalStorage_V1")
            try manager.createDirectory(at: current.appendingPathComponent("nested"), withIntermediateDirectories: true)
            let names = ["manifest.json", "synthetic-external-value", ".hidden", "nested/fixture"]
            let bytes = Data(repeating: 42, count: 4096)
            for name in names { try bytes.write(to: current.appendingPathComponent(name)) }
            for _ in 0..<2 {
                try GuardianStorageProtection.protectAsyncStorage(applicationSupport: support,
                    documents: documents, bundleID: bundleID)
                try assertProtected(current)
                for name in names {
                    let file = current.appendingPathComponent(name)
                    try assertProtected(file)
                    XCTAssertEqual(try Data(contentsOf: file), bytes)
                }
            }
        }
    }

    func testInvalidBundleOrUnexpectedStoreTypeFailsWithoutReplacingData() throws {
        try fixture { _, support, documents in
            for invalid in ["", "..", "../elsewhere", "/tmp/escape", "a\\b"] {
                XCTAssertThrowsError(try GuardianStorageProtection.protectAsyncStorage(
                    applicationSupport: support, documents: documents, bundleID: invalid))
            }
            let current = support.appendingPathComponent(bundleID).appendingPathComponent("RCTAsyncLocalStorage_V1")
            try manager.createDirectory(at: current.deletingLastPathComponent(), withIntermediateDirectories: true)
            let bytes = Data("do not replace this file".utf8)
            try bytes.write(to: current)
            XCTAssertThrowsError(try GuardianStorageProtection.protectAsyncStorage(applicationSupport: support,
                documents: documents, bundleID: bundleID))
            XCTAssertEqual(try Data(contentsOf: current), bytes)
        }
    }

    func testSymlinkStoreAndSymlinkAncestorCannotTouchAnOutsideFixture() throws {
        try fixture { root, support, documents in
            let outside = root.appendingPathComponent("unrelated")
            try manager.createDirectory(at: outside, withIntermediateDirectories: true)
            let file = outside.appendingPathComponent("manifest.json")
            let bytes = Data("unrelated fixture".utf8)
            try bytes.write(to: file)
            try removeProtection(file)
            let old = try manager.attributesOfItem(atPath: file.path)
            let parent = support.appendingPathComponent(bundleID)
            try manager.createDirectory(at: parent, withIntermediateDirectories: true)
            try manager.createSymbolicLink(at: parent.appendingPathComponent("RCTAsyncLocalStorage_V1"),
                                           withDestinationURL: outside)
            XCTAssertThrowsError(try GuardianStorageProtection.protectAsyncStorage(applicationSupport: support,
                documents: documents, bundleID: bundleID))
            let link = documents.appendingPathComponent("linked-parent")
            try manager.createSymbolicLink(at: link, withDestinationURL: outside)
            XCTAssertThrowsError(try GuardianStorageProtection.prepareDirectory(link.appendingPathComponent("child")))
            XCTAssertFalse(manager.fileExists(atPath: outside.appendingPathComponent("child").path))
            XCTAssertEqual(try Data(contentsOf: file), bytes)
            let next = try manager.attributesOfItem(atPath: file.path)
            XCTAssertEqual(String(describing: old[.protectionKey]), String(describing: next[.protectionKey]))
        }
    }

    func testNativeExistingStateUpgradesMetadataWithoutRewritingItsJSON() throws {
        try fixture { root, _, _ in
            let url = root.appendingPathComponent("GuardianCore/state-v1.json")
            let store = try GuardianEventStore(fileURL: url)
            try store.setMovementAnchor(nil)
            let bytes = try Data(contentsOf: url)
            try removeProtection(url)
            try removeProtection(url.deletingLastPathComponent())
            _ = try GuardianEventStore(fileURL: url)
            try assertProtected(url)
            try assertProtected(url.deletingLastPathComponent())
            XCTAssertEqual(try Data(contentsOf: url), bytes)
        }
    }

    func testNativeAtomicWritesRestoreProtectionOnEveryReplacement() throws {
        try fixture { root, _, _ in
            let url = root.appendingPathComponent("GuardianCore/state-v1.json")
            let store = try GuardianEventStore(fileURL: url)
            for _ in 0..<3 {
                try store.setMovementAnchor(nil)
                try assertProtected(url)
                try assertProtected(url.deletingLastPathComponent())
                try removeProtection(url)
            }
        }
    }

    func testUnexpectedNativeFileDirectoryIsNotRewrittenOrCleared() throws {
        try fixture { root, _, _ in
            let url = root.appendingPathComponent("GuardianCore/state-v1.json")
            try manager.createDirectory(at: url, withIntermediateDirectories: true)
            let file = url.appendingPathComponent("keep")
            let bytes = Data("untouched fixture".utf8)
            try bytes.write(to: file)
            XCTAssertThrowsError(try GuardianEventStore(fileURL: url))
            XCTAssertEqual(try Data(contentsOf: file), bytes)
        }
    }

    private var guardianKey: String { "@daojia_shuo_yisheng/guardian_state_v1" }
    private var guardianFilename: String {
        Insecure.MD5.hash(data: Data(guardianKey.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    func testExplicitLegacyClearRemovesOnlyGuardianKeyAndItsExternalFile() throws {
        try fixture { _, _, documents in
            let names = ["RCTAsyncLocalStorage_V1", "RNCAsyncLocalStorage_V1", "RCTAsyncLocalStorage"]
            for (index, name) in names.enumerated() {
                let directory = documents.appendingPathComponent(name)
                try manager.createDirectory(at: directory, withIntermediateDirectories: true)
                let manifest: [String: Any] = [guardianKey: index == 0 ? ("inline fixture" as Any) : NSNull(),
                                               "unrelated": "keep", "other-external": NSNull()]
                try JSONSerialization.data(withJSONObject: manifest).write(to: directory.appendingPathComponent("manifest.json"))
                try Data("erase fixture".utf8).write(to: directory.appendingPathComponent(guardianFilename))
                try Data("unrelated fixture".utf8).write(to: directory.appendingPathComponent("other-file"))
            }
            let unrelatedDirectory = documents.appendingPathComponent("unrelated")
            try manager.createDirectory(at: unrelatedDirectory, withIntermediateDirectories: true)
            try Data("keep".utf8).write(to: unrelatedDirectory.appendingPathComponent(guardianFilename))
            try GuardianStorageProtection.clearLegacyGuardianData(documents: documents)
            for name in names {
                let directory = documents.appendingPathComponent(name)
                let manifestURL = directory.appendingPathComponent("manifest.json")
                let manifest = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: manifestURL)) as? [String: Any])
                XCTAssertNil(manifest[guardianKey])
                XCTAssertEqual(manifest["unrelated"] as? String, "keep")
                XCTAssertTrue(manifest["other-external"] is NSNull)
                XCTAssertEqual(try Data(contentsOf: directory.appendingPathComponent("other-file")), Data("unrelated fixture".utf8))
                XCTAssertFalse(manager.fileExists(atPath: directory.appendingPathComponent(guardianFilename).path))
                try assertProtected(manifestURL)
            }
            XCTAssertEqual(try Data(contentsOf: unrelatedDirectory.appendingPathComponent(guardianFilename)), Data("keep".utf8))
        }
    }

    func testInterruptedLegacyClearRemovesOrphanAndCanBeRepeated() throws {
        try fixture { _, _, documents in
            let directory = documents.appendingPathComponent("RCTAsyncLocalStorage_V1")
            try manager.createDirectory(at: directory, withIntermediateDirectories: true)
            let manifestURL = directory.appendingPathComponent("manifest.json")
            let manifest = Data("{\"unrelated\":\"keep\"}".utf8)
            try manifest.write(to: manifestURL)
            try Data("orphan".utf8).write(to: directory.appendingPathComponent(guardianFilename))
            for _ in 0..<2 { try GuardianStorageProtection.clearLegacyGuardianData(documents: documents) }
            XCTAssertFalse(manager.fileExists(atPath: directory.appendingPathComponent(guardianFilename).path))
            XCTAssertEqual(try Data(contentsOf: manifestURL), manifest)
        }
    }

    func testCorruptLegacyManifestFailsClearWithoutGuessingOrDiscardingData() throws {
        try fixture { _, _, documents in
            let directory = documents.appendingPathComponent("RCTAsyncLocalStorage_V1")
            try manager.createDirectory(at: directory, withIntermediateDirectories: true)
            let manifestURL = directory.appendingPathComponent("manifest.json")
            let corrupt = Data("{broken fixture".utf8)
            try corrupt.write(to: manifestURL)
            let payload = Data("untouched fixture".utf8)
            let file = directory.appendingPathComponent(guardianFilename)
            try payload.write(to: file)
            XCTAssertThrowsError(try GuardianStorageProtection.clearLegacyGuardianData(documents: documents))
            XCTAssertEqual(try Data(contentsOf: manifestURL), corrupt)
            XCTAssertEqual(try Data(contentsOf: file), payload)
        }
    }

    func testLegacyClearRejectsLinkedDirectoriesWithoutDeletingTheirTarget() throws {
        try fixture { root, _, documents in
            let other = root.appendingPathComponent("other")
            try manager.createDirectory(at: other, withIntermediateDirectories: true)
            let file = other.appendingPathComponent(guardianFilename)
            try Data("keep".utf8).write(to: file)
            try manager.createSymbolicLink(at: documents.appendingPathComponent("RCTAsyncLocalStorage_V1"),
                                           withDestinationURL: other)
            XCTAssertThrowsError(try GuardianStorageProtection.clearLegacyGuardianData(documents: documents))
            XCTAssertEqual(try Data(contentsOf: file), Data("keep".utf8))
        }
    }
}
