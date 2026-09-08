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
}
