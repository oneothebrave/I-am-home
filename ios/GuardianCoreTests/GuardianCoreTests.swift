import XCTest
import CoreLocation

// Add this file and the four model/store/policy source files to an iOS unit-test
// target. It deliberately does not require a guessed application module name.
final class GuardianCoreTests: XCTestCase {
    private func location(
        latitude: Double = 30,
        accuracy: Double = 10,
        speed: Double = -1,
        time: Date
    ) -> CLLocation {
        CLLocation(coordinate: CLLocationCoordinate2D(latitude: latitude, longitude: 120), altitude: 0,
                   horizontalAccuracy: accuracy, verticalAccuracy: 10, course: -1,
                   speed: speed, timestamp: time)
    }

    private var shanghaiCalendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Asia/Shanghai")!
        return calendar
    }

    private func localDate(hour: Int, minute: Int = 0) -> Date {
        shanghaiCalendar.date(from: DateComponents(
            timeZone: shanghaiCalendar.timeZone,
            year: 2026,
            month: 9,
            day: 21,
            hour: hour,
            minute: minute
        ))!
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
        XCTAssertTrue(GuardianLocationPolicy.indicatesMotion(
            from: location(time: now.addingTimeInterval(-10)),
            to: location(latitude: 30.01, speed: 1, time: now)
        ))
    }

    func testAdaptiveLocationMovementSurvivesLongStationaryGapAndStoreReload() throws {
        let now = Date()
        let anchor = location(accuracy: 5, time: now)
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = directory.appendingPathComponent("state.json")
        let store = try GuardianEventStore(fileURL: url)
        try store.setMovementAnchor(GuardianMovementAnchor(anchor))
        let restored = try GuardianEventStore(fileURL: url)
        let saved = restored.movementAnchor?.location
        XCTAssertFalse(GuardianLocationPolicy.indicatesMotion(from: saved,
            to: location(latitude: 30.00004, accuracy: 5, time: now.addingTimeInterval(300))))
        XCTAssertFalse(GuardianLocationPolicy.indicatesMotion(from: saved,
            to: location(latitude: 30.00029, accuracy: 5, time: now.addingTimeInterval(330))))
        XCTAssertTrue(GuardianLocationPolicy.indicatesMotion(from: saved,
            to: location(latitude: 30.00009, accuracy: 5, speed: 1,
                         time: now.addingTimeInterval(360))))
        XCTAssertFalse(GuardianLocationPolicy.indicatesMotion(from: saved,
            to: location(latitude: 30.00022, accuracy: 40, time: now.addingTimeInterval(360))))
    }

    func testPedometerRequiresSeveralStepsInsteadOfOneCallback() {
        XCTAssertFalse(GuardianLocationPolicy.indicatesPedometerMovement(
            totalSteps: 4,
            lastAcceptedSteps: 0
        ))
        XCTAssertTrue(GuardianLocationPolicy.indicatesPedometerMovement(
            totalSteps: 5,
            lastAcceptedSteps: 0
        ))
        XCTAssertFalse(GuardianLocationPolicy.indicatesPedometerMovement(
            totalSteps: 8,
            lastAcceptedSteps: 5
        ))
        XCTAssertTrue(GuardianLocationPolicy.indicatesPedometerMovement(
            totalSteps: 10,
            lastAcceptedSteps: 5
        ))
    }

    func testPreparedMessageUsesNamedPlaceAndCoordinates() throws {
        let point = location(latitude: 30.12345, accuracy: 9, time: Date())
        let event = GuardianEvent(
            type: .noMotionForLongTime,
            title: "测试",
            description: "测试",
            timestamp: point.timestamp,
            source: "motion",
            location: point,
            locationLabel: "农场"
        )
        let contact = try GuardianNotificationContact(dictionary: [
            "id": "family", "name": "家人", "phone": "+8613800000000", "priority": 1
        ])
        let message = try XCTUnwrap(GuardianCriticalMessageOperation.prepare(
            for: event,
            contacts: [contact],
            thresholdMinutes: 5
        ).first?.messageText)
        XCTAssertTrue(message.contains("位置：农场"))
        XCTAssertTrue(message.contains("纬度 30.12345"))
        XCTAssertTrue(message.contains("精度约 9 米"))
    }

    func testUnresolvedIncidentSurvivesDetectorResetAndQueueAcknowledgement() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = directory.appendingPathComponent("state.json")
        let store = try GuardianEventStore(fileURL: url)
        let now = Date()
        var state = GuardianInactivityState()
        state.leaveHome(at: now)
        XCTAssertTrue(state.evaluate(at: now.addingTimeInterval(60), thresholdMinutes: 1))
        let event = GuardianEvent(type: .noMotionForLongTime, title: "测试", description: "测试",
            timestamp: now.addingTimeInterval(60), source: "motion")
        try store.append(event, updatingInactivity: state)
        try store.acknowledge([event.id])
        var reset = GuardianInactivityState()
        reset.leaveHome(at: now.addingTimeInterval(70))
        try store.setInactivity(reset)
        let restored = try GuardianEventStore(fileURL: url)
        XCTAssertTrue(restored.hasUnresolvedInactivityIncident)
        let duplicate = GuardianEvent(type: .noMotionForLongTime, title: "测试", description: "测试",
            timestamp: now.addingTimeInterval(140), source: "motion")
        try restored.append(duplicate, updatingInactivity: reset)
        XCTAssertTrue(restored.pendingEvents.isEmpty)
        try restored.append(GuardianEvent(type: .motionDetected, title: "历史活动", description: "测试",
            timestamp: now, source: "motion"))
        XCTAssertTrue(restored.hasUnresolvedInactivityIncident)
        try restored.append(GuardianEvent(type: .motionDetected, title: "恢复活动", description: "测试",
            timestamp: now.addingTimeInterval(150), source: "motion"))
        XCTAssertFalse(restored.hasUnresolvedInactivityIncident)
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

    func testOneMinuteInactivityThresholdForFieldTesting() throws {
        let start = Date(timeIntervalSince1970: 1_800_000_000)
        var state = GuardianInactivityState()
        state.leaveHome(at: start)
        XCTAssertEqual(
            state.nextEvaluationDate(thresholdMinutes: 1),
            start.addingTimeInterval(60)
        )
        XCTAssertFalse(state.evaluate(at: start.addingTimeInterval(59), thresholdMinutes: 1))
        XCTAssertTrue(state.evaluate(at: start.addingTimeInterval(60), thresholdMinutes: 1))
        XCTAssertNil(state.nextEvaluationDate(thresholdMinutes: 1))

        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = try GuardianEventStore(fileURL: directory.appendingPathComponent("state.json"))
        try store.setNoMotionThresholdMinutes(1)
        XCTAssertEqual(store.noMotionThresholdMinutes, 1)
    }

    func testGeofenceMatchingKeepsUnchangedSystemRegions() throws {
        let fence = try GuardianGeofence(dictionary: [
            "id": "home",
            "name": "家",
            "kind": "home",
            "radiusMeters": 150.0,
            "center": ["latitude": 30.0, "longitude": 120.0]
        ])
        XCTAssertTrue(fence.matches(fence.region()))
        XCTAssertFalse(fence.matches(CLCircularRegion(
            center: CLLocationCoordinate2D(latitude: 30.01, longitude: 120),
            radius: 150,
            identifier: "home"
        )))
        XCTAssertFalse(fence.matches(CLCircularRegion(
            center: CLLocationCoordinate2D(latitude: 30, longitude: 120),
            radius: 300,
            identifier: "home"
        )))
    }

    func testSingleActiveWindowUsesStartInclusiveAndEndExclusive() throws {
        let window = try GuardianActiveWindow(startTime: "07:00", endTime: "18:00")
        XCTAssertFalse(window.contains(localDate(hour: 6, minute: 59), calendar: shanghaiCalendar))
        XCTAssertTrue(window.contains(localDate(hour: 7), calendar: shanghaiCalendar))
        XCTAssertTrue(window.contains(localDate(hour: 17, minute: 59), calendar: shanghaiCalendar))
        XCTAssertFalse(window.contains(localDate(hour: 18), calendar: shanghaiCalendar))
        XCTAssertEqual(
            window.nextBoundary(after: localDate(hour: 10), calendar: shanghaiCalendar),
            localDate(hour: 18)
        )
    }

    func testWritingTheSameActiveWindowDoesNotReportAChange() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = try GuardianEventStore(fileURL: directory.appendingPathComponent("state.json"))
        let window = try GuardianActiveWindow(startTime: "07:00", endTime: "18:00")

        XCTAssertTrue(try store.setActiveWindow(window))
        XCTAssertFalse(try store.setActiveWindow(window))
        XCTAssertTrue(
            try store.setActiveWindow(
                GuardianActiveWindow(startTime: "08:00", endTime: "19:00")
            )
        )
    }

    func testInactiveWindowClearsElapsedTimeBeforeNextWindow() {
        var state = GuardianInactivityState()
        state.leaveHome(at: localDate(hour: 8))
        XCTAssertTrue(state.evaluate(at: localDate(hour: 10), thresholdMinutes: 120))

        state.suspendAwayTracking()
        XCTAssertFalse(state.evaluate(at: localDate(hour: 14), thresholdMinutes: 120))
        state.resumeAwayTracking(noEarlierThan: localDate(hour: 14))
        XCTAssertFalse(state.evaluate(at: localDate(hour: 15, minute: 59), thresholdMinutes: 120))
        XCTAssertTrue(state.evaluate(at: localDate(hour: 16), thresholdMinutes: 120))
    }

    func testInactivityConfigurationAndStateSurviveRecreation() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = directory.appendingPathComponent("state.json")
        let fence = try GuardianGeofence(dictionary: ["id": "home", "name": "家", "kind": "home", "radiusMeters": 150.0, "center": ["latitude": 30.0, "longitude": 120.0]])
        let window = try GuardianActiveWindow(startTime: "07:00", endTime: "18:00")
        let store = try GuardianEventStore(fileURL: url)
        try store.configure(
            enabled: true,
            geofences: [fence],
            noMotionThresholdMinutes: 75,
            activeWindow: window
        )
        var inactivity = GuardianInactivityState()
        inactivity.leaveHome(at: Date(timeIntervalSince1970: 1_800_000_000))
        try store.setInactivity(inactivity)

        let restored = try GuardianEventStore(fileURL: url)
        XCTAssertEqual(restored.noMotionThresholdMinutes, 75)
        XCTAssertEqual(restored.activeWindow, window)
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
        let contact = try GuardianNotificationContact(dictionary: [
            "id": "family-1", "name": "小林", "phone": "+8618768106491", "priority": 1
        ])
        try store.setNotificationContacts([contact])
        let messages = GuardianCriticalMessageOperation.prepare(
            for: event,
            contacts: store.notificationContacts,
            thresholdMinutes: 120
        )

        try store.append(event, updatingInactivity: inactivity, criticalMessages: messages)

        let restored = try GuardianEventStore(fileURL: url)
        XCTAssertEqual(restored.inactivity, inactivity)
        XCTAssertEqual(restored.pendingEvents.map(\.id), [event.id])
        XCTAssertEqual(restored.notificationContacts, [contact])
        XCTAssertEqual(restored.criticalMessageOperations, messages)
        XCTAssertEqual(restored.criticalMessageOperations.first?.status, .prepared)
        XCTAssertEqual(restored.criticalMessageOperations.first?.phoneNumber, "+8618768106491")
        XCTAssertEqual(restored.criticalMessageOperations.first?.shortcutAttemptPending, true)

        let operation = try XCTUnwrap(restored.criticalMessageOperations.first)
        let shortcutURL = try XCTUnwrap(GuardianShortcutNotification.url(for: operation))
        let components = try XCTUnwrap(URLComponents(url: shortcutURL, resolvingAgainstBaseURL: false))
        XCTAssertEqual(components.scheme, "shortcuts")
        XCTAssertEqual(components.host, "run-shortcut")
        XCTAssertEqual(
            components.queryItems?.first(where: { $0.name == "name" })?.value,
            "到家了么短信通知 V3"
        )
        let payloadText = try XCTUnwrap(
            components.queryItems?.first(where: { $0.name == "text" })?.value
        )
        let payload = try XCTUnwrap(
            JSONSerialization.jsonObject(with: Data(payloadText.utf8)) as? [String: String]
        )
        XCTAssertEqual(payload["phone"], "+8618768106491")
        XCTAssertEqual(payload["message"], operation.messageText)

        let attempted = try XCTUnwrap(
            try restored.beginShortcutAttempt(operationId: operation.id, at: event.timestamp)
        )
        XCTAssertEqual(attempted.shortcutAttemptedAt, event.timestamp)
        XCTAssertNil(
            try restored.beginShortcutAttempt(operationId: operation.id, at: event.timestamp)
        )
        try restored.completeShortcutAttempt(operationId: operation.id, succeeded: nil, error: "后台结果未知")
        let completed = try XCTUnwrap(restored.criticalMessageOperations.first)
        XCTAssertEqual(completed.shortcutAttemptPending, false)
        XCTAssertNil(completed.shortcutOpenSucceeded)
        XCTAssertEqual(completed.shortcutAttemptError, "后台结果未知")
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
        XCTAssertNil(restored.activeWindow)
        XCTAssertEqual(restored.inactivity.homePresence, .unknown)
        let migrated = try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any]
        XCTAssertEqual(migrated?["version"] as? Int, 4)
    }
}
