import XCTest
import CoreLocation

// Add this file and the four model/store/policy source files to an iOS unit-test
// target. It deliberately does not require a guessed application module name.
final class GuardianCoreTests: XCTestCase {
    private func location(latitude: Double = 30, accuracy: Double = 10, time: Date) -> CLLocation {
        CLLocation(coordinate: CLLocationCoordinate2D(latitude: latitude, longitude: 120), altitude: 0,
                   horizontalAccuracy: accuracy, verticalAccuracy: 10, timestamp: time)
    }

    func testRejectsOldInaccurateAndFutureLocations() {
        let now = Date()
        XCTAssertFalse(GuardianLocationPolicy.accepts(location(time: now.addingTimeInterval(-121)), now: now))
        XCTAssertFalse(GuardianLocationPolicy.accepts(location(accuracy: 101, time: now), now: now))
        XCTAssertFalse(GuardianLocationPolicy.accepts(location(time: now.addingTimeInterval(6)), now: now))
        XCTAssertTrue(GuardianLocationPolicy.accepts(location(time: now), now: now))
    }

    func testInitialAndStationaryFixesAreNotMovement() {
        let now = Date()
        XCTAssertFalse(GuardianLocationPolicy.indicatesMotion(from: nil, to: location(time: now)))
        XCTAssertFalse(GuardianLocationPolicy.indicatesMotion(from: location(time: now.addingTimeInterval(-10)), to: location(time: now)))
        XCTAssertTrue(GuardianLocationPolicy.indicatesMotion(from: location(time: now.addingTimeInterval(-10)), to: location(latitude: 30.01, time: now)))
    }

    func testSerializationKeepsStableIdentityAndOmitsUnknownBattery() {
        let event = GuardianEvent(type: .sosSent, title: "SOS", description: "Help", timestamp: Date(), source: "user", batteryLevel: -1)
        XCTAssertEqual(event.toDictionary()["id"] as? String, event.toDictionary()["id"] as? String)
        XCTAssertNil(event.toDictionary()["batteryLevel"])
    }

    func testQueueAndConfigurationSurviveRecreationAndAcknowledgement() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = directory.appendingPathComponent("state.json")
        let fence = try GuardianGeofence(dictionary: ["id": "home", "name": "Home", "kind": "home", "radiusMeters": 160.0, "center": ["latitude": 30.0, "longitude": 120.0]])
        let store = try GuardianEventStore(fileURL: url)
        try store.configure(enabled: true, geofences: [fence])
        let event = GuardianEvent(type: .returnHome, title: "Home", description: "At home", timestamp: Date(), source: "geofence")
        try store.append(event)
        try store.append(event)
        let restored = try GuardianEventStore(fileURL: url)
        XCTAssertTrue(restored.enabled)
        XCTAssertEqual(restored.geofences.first?.id, "home")
        XCTAssertEqual(restored.pendingEvents.map(\.id), [event.id])
        try restored.acknowledge([event.id])
        XCTAssertTrue(try GuardianEventStore(fileURL: url).pendingEvents.isEmpty)
    }

    func testInactivityOnlyTriggersAwayFromHomeAndOnlyOncePerQuietPeriod() {
        let start = Date(timeIntervalSince1970: 1_800_000_000)
        var state = GuardianInactivityState()
        state.enterHome(at: start)
        XCTAssertFalse(state.evaluate(at: start.addingTimeInterval(3 * 60 * 60), thresholdMinutes: 120))

        state.leaveHome(at: start.addingTimeInterval(10))
        XCTAssertFalse(state.evaluate(at: start.addingTimeInterval(119 * 60), thresholdMinutes: 120))
        XCTAssertTrue(state.evaluate(at: start.addingTimeInterval(121 * 60), thresholdMinutes: 120))
        XCTAssertFalse(state.evaluate(at: start.addingTimeInterval(180 * 60), thresholdMinutes: 120))

        XCTAssertTrue(state.observeMovement(at: start.addingTimeInterval(181 * 60)))
        XCTAssertFalse(state.evaluate(at: start.addingTimeInterval(300 * 60), thresholdMinutes: 120))
        XCTAssertTrue(state.evaluate(at: start.addingTimeInterval(302 * 60), thresholdMinutes: 120))
        state.enterHome(at: start.addingTimeInterval(303 * 60))
        XCTAssertFalse(state.evaluate(at: start.addingTimeInterval(500 * 60), thresholdMinutes: 120))
    }

    func testInactivityConfigurationAndStateSurviveRecreation() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = directory.appendingPathComponent("state.json")
        let fence = try GuardianGeofence(dictionary: ["id": "home", "name": "家", "kind": "home", "radiusMeters": 150.0, "center": ["latitude": 30.0, "longitude": 120.0]])
        let store = try GuardianEventStore(fileURL: url)
        try store.configure(enabled: true, geofences: [fence], noMotionThresholdMinutes: 75)
        var inactivity = GuardianInactivityState()
        inactivity.leaveHome(at: Date(timeIntervalSince1970: 1_800_000_000))
        try store.setInactivity(inactivity)

        let restored = try GuardianEventStore(fileURL: url)
        XCTAssertEqual(restored.noMotionThresholdMinutes, 75)
        XCTAssertEqual(restored.inactivity, inactivity)
    }

    func testInactivityAlertAndQueuedEventAreCommittedTogether() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = directory.appendingPathComponent("state.json")
        let store = try GuardianEventStore(fileURL: url)
        var inactivity = GuardianInactivityState()
        let start = Date(timeIntervalSince1970: 1_800_000_000)
        inactivity.leaveHome(at: start)
        XCTAssertTrue(inactivity.evaluate(at: start.addingTimeInterval(121 * 60), thresholdMinutes: 120))
        let event = GuardianEvent(
            type: .noMotionForLongTime,
            title: "在家外长时间没有明显移动",
            description: "测试",
            timestamp: start.addingTimeInterval(121 * 60),
            source: "motion"
        )

        try store.append(event, updatingInactivity: inactivity)

        let restored = try GuardianEventStore(fileURL: url)
        XCTAssertEqual(restored.inactivity, inactivity)
        XCTAssertEqual(restored.pendingEvents.map(\.id), [event.id])
    }

    func testVersionOneStoreMigratesWithoutLosingGuardianConfiguration() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let url = directory.appendingPathComponent("state.json")
        let json = """
        {"version":1,"enabled":true,"geofences":[{"id":"home","name":"家","kind":"home","center":{"latitude":30,"longitude":120},"radiusMeters":150}],"events":[]}
        """
        try Data(json.utf8).write(to: url)

        let restored = try GuardianEventStore(fileURL: url)
        XCTAssertTrue(restored.enabled)
        XCTAssertEqual(restored.geofences.map(\.id), ["home"])
        XCTAssertEqual(restored.noMotionThresholdMinutes, 120)
        XCTAssertEqual(restored.inactivity.homePresence, .unknown)
        let migrated = try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any]
        XCTAssertEqual(migrated?["version"] as? Int, 2)
    }
}
