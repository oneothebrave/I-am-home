import XCTest
import Foundation

final class GuardianStorageIntegrityTests: XCTestCase {
    private let manager = FileManager.default
    private let bundleID = "com.example.integrity-test"
    private let value = "{\"schemaVersion\":4,\"synthetic\":true}"

    private struct Fixture {
        let root: URL
        let support: URL
        let documents: URL
        let current: URL
        var receipt: URL { support.appendingPathComponent("GuardianStorageIntegrity/receipt-v1.json") }
    }
    private func fixture(_ body: (Fixture) throws -> Void) throws {
        let root = manager.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let support = root.appendingPathComponent("Application Support")
        let documents = root.appendingPathComponent("Documents")
        try manager.createDirectory(at: support, withIntermediateDirectories: true)
        try manager.createDirectory(at: documents, withIntermediateDirectories: true)
        defer { try? manager.removeItem(at: root) }
        try body(Fixture(root: root, support: support, documents: documents,
                         current: support.appendingPathComponent(bundleID).appendingPathComponent("RCTAsyncLocalStorage_V1")))
    }
    private func check(_ f: Fixture, _ operation: String = "read", _ phase: String = "before",
                       value: String? = nil, authorized: Bool = false) throws {
        let request: [String: Any] = ["operation": operation, "phase": phase, "value": value.map { $0 as Any } ?? NSNull()]
        try GuardianStorageIntegrity.check(GuardianStorageIntegrity.Access(request), deletionAuthorized: authorized,
            support: f.support, documents: f.documents, bundleID: bundleID)
    }
    private func manifest(_ directory: URL, _ value: Any) throws {
        try manager.createDirectory(at: directory, withIntermediateDirectories: true)
        let data = try JSONSerialization.data(withJSONObject: [GuardianStorageProtection.guardianKey: value, "unrelated": "keep"])
        try data.write(to: directory.appendingPathComponent("manifest.json"))
    }
    private func external(_ directory: URL, _ bytes: Data) throws {
        try bytes.write(to: directory.appendingPathComponent(GuardianStorageProtection.guardianFilename))
    }

    func testFreshInstallationIsEmptyWithoutCreatingMigrationDestination() throws {
        try fixture { f in
            try check(f)
            XCTAssertFalse(manager.fileExists(atPath: f.current.path))
            try manager.createDirectory(at: f.current, withIntermediateDirectories: true)
            try check(f, "read", "after")
            XCTAssertTrue(manager.fileExists(atPath: f.receipt.path))
            try check(f)
        }
    }

    func testInlineAndExternalValuesSurviveChecksByteForByte() throws {
        for externalValue in [false, true] {
            try fixture { f in
                try manifest(f.current, externalValue ? (NSNull() as Any) : value)
                if externalValue { try external(f.current, Data(value.utf8)) }
                let file = f.current.appendingPathComponent("manifest.json")
                let before = try Data(contentsOf: file)
                try check(f)
                try check(f, "read", "after", value: value)
                XCTAssertEqual(try Data(contentsOf: file), before)
                if externalValue {
                    XCTAssertEqual(try Data(contentsOf: f.current.appendingPathComponent(GuardianStorageProtection.guardianFilename)), Data(value.utf8))
                }
            }
        }
    }

    func testCorruptOrWrongShapeManifestsBlockBeforeTheLibraryCanResetThem() throws {
        for raw in ["{broken", "[]", "null", "{\"foreign\":42}"] {
            try fixture { f in
                try manager.createDirectory(at: f.current, withIntermediateDirectories: true)
                let file = f.current.appendingPathComponent("manifest.json")
                let bytes = Data(raw.utf8)
                try bytes.write(to: file)
                XCTAssertThrowsError(try check(f))
                XCTAssertThrowsError(try check(f, "write"))
                XCTAssertThrowsError(try check(f, "deletion", authorized: true))
                XCTAssertEqual(try Data(contentsOf: file), bytes)
                XCTAssertFalse(manager.fileExists(atPath: f.receipt.path))
            }
        }
    }

    func testMissingExternalValueIsNotANewInstallation() throws {
        try fixture { f in
            try manifest(f.current, NSNull())
            XCTAssertThrowsError(try check(f))
            XCTAssertThrowsError(try check(f, "write"))
            XCTAssertFalse(manager.fileExists(atPath: f.receipt.path))
        }
    }

    func testInvalidUTF8OrInvalidJSONExternalValueIsPreserved() throws {
        for bytes in [Data([0xff, 0xfe]), Data("{broken".utf8), Data("null".utf8), Data()] {
            try fixture { f in
                try manifest(f.current, NSNull())
                try external(f.current, bytes)
                XCTAssertThrowsError(try check(f))
                XCTAssertEqual(try Data(contentsOf: f.current.appendingPathComponent(GuardianStorageProtection.guardianFilename)), bytes)
            }
        }
    }

    func testMissingManifestWithAnOrphanFileFailsClosed() throws {
        try fixture { f in
            try manager.createDirectory(at: f.current, withIntermediateDirectories: true)
            try external(f.current, Data(value.utf8))
            XCTAssertThrowsError(try check(f))
            XCTAssertFalse(manager.fileExists(atPath: f.current.appendingPathComponent("manifest.json").path))
        }
    }

    func testInvalidInlineJSONCannotReachTheLibrary() throws {
        try fixture { f in
            try manifest(f.current, "{broken")
            XCTAssertThrowsError(try check(f))
            try check(f, "deletion", authorized: true)
        }
    }

    func testReceiptDetectsLostCurrentDirectoryAcrossAProcessRestart() throws {
        try fixture { f in
            try manifest(f.current, value)
            try check(f)
            // Only the isolated UUID fixture is removed to simulate lost storage.
            try manager.removeItem(at: f.current)
            XCTAssertThrowsError(try check(f))
            XCTAssertFalse(manager.fileExists(atPath: f.current.path))
        }
    }

    func testLibraryNullOrWrongWriteResultCannotPassAfterCheck() throws {
        try fixture { f in
            try manifest(f.current, value)
            try check(f)
            XCTAssertThrowsError(try check(f, "read", "after"))
            XCTAssertThrowsError(try check(f, "write", "after", value: "{\"other\":true}"))
            try check(f, "read", "after", value: value)
        }
    }

    func testSingleLegacyMigrationPreservesDataAndReceipt() throws {
        try fixture { f in
            let old = f.documents.appendingPathComponent("RCTAsyncLocalStorage_V1")
            try manifest(old, value)
            try check(f)
            XCTAssertFalse(manager.fileExists(atPath: f.current.path))
            try manager.copyItem(at: old, to: f.current)
            try check(f, "read", "after", value: value)
            XCTAssertTrue(manager.fileExists(atPath: old.path))
        }
    }

    func testConflictingLegacyCopiesAreNotSelectedByGuessingDates() throws {
        try fixture { f in
            try manifest(f.documents.appendingPathComponent("RCTAsyncLocalStorage_V1"), value)
            try manifest(f.documents.appendingPathComponent("RNCAsyncLocalStorage_V1"), "{\"other\":true}")
            XCTAssertThrowsError(try check(f))
            XCTAssertFalse(manager.fileExists(atPath: f.current.path))
        }
    }

    func testEmptyCurrentDestinationCannotHideOldData() throws {
        try fixture { f in
            try manifest(f.documents.appendingPathComponent("RCTAsyncLocalStorage_V1"), value)
            try manager.createDirectory(at: f.current, withIntermediateDirectories: true)
            XCTAssertThrowsError(try check(f))
        }
    }

    func testExplicitDeletionCanReplaceMissingValueOnlyWithNativeAuthorization() throws {
        try fixture { f in
            try manifest(f.current, NSNull())
            // A damaged legacy payload must not prevent a valid replacement journal
            // from being verified before the existing legacy-key cleanup runs.
            try manifest(f.documents.appendingPathComponent("RCTAsyncLocalStorage_V1"), NSNull())
            XCTAssertThrowsError(try check(f, "deletion"))
            try check(f, "deletion", authorized: true)
            try manifest(f.current, value)
            try external(f.current, Data("old orphan".utf8))
            try check(f, "deletion", "after", value: value, authorized: true)
            XCTAssertFalse(manager.fileExists(atPath: f.current.appendingPathComponent(GuardianStorageProtection.guardianFilename).path))
            let stored = try JSONSerialization.jsonObject(with: Data(contentsOf: f.current.appendingPathComponent("manifest.json"))) as? [String: Any]
            XCTAssertEqual(stored?["unrelated"] as? String, "keep")
        }
    }

    func testDamagedReceiptRequiresExplicitDeletionAndDoesNotExposeContents() throws {
        try fixture { f in
            try manifest(f.current, value)
            try check(f)
            try Data("{broken receipt".utf8).write(to: f.receipt)
            XCTAssertThrowsError(try check(f))
            try check(f, "deletion", authorized: true)
            try check(f, "deletion", "after", value: value, authorized: true)
            try check(f)
        }
    }

    func testFailedRemoveDoesNotRecordACompletedClear() throws {
        try fixture { f in
            try manifest(f.current, value)
            try check(f)
            let receipt = try Data(contentsOf: f.receipt)
            try Data("{}".utf8).write(to: f.current.appendingPathComponent("manifest.json"))
            XCTAssertThrowsError(try check(f, "remove", "failed"))
            XCTAssertEqual(try Data(contentsOf: f.receipt), receipt)
            try check(f, "remove", "after")
            try check(f)
        }
    }

    func testMalformedBridgeRequestsAreRejected() {
        let requests: [[String: Any]] = [[:], ["operation": "read", "phase": "before", "value": "unexpected"],
            ["operation": "write", "phase": "after", "value": NSNull()],
            ["operation": "read", "phase": "skip", "value": NSNull()],
            ["operation": "remove", "phase": "after", "value": "unexpected"]]
        for request in requests {
            XCTAssertThrowsError(try GuardianStorageIntegrity.Access(request))
        }
    }
}
