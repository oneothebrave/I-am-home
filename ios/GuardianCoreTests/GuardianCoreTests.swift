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

    func testUserPauseSurvivesReloadAndOnlyExplicitResumeCanClearIt() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = directory.appendingPathComponent("state.json")
        let store = try GuardianEventStore(fileURL: url)
        XCTAssertFalse(store.userPaused)
        try store.configure(enabled: true, geofences: [])
        try store.configure(enabled: false, geofences: [], userPaused: true)
        let restored = try GuardianEventStore(fileURL: url)
        XCTAssertTrue(restored.userPaused)
        XCTAssertFalse(restored.enabled)
        try restored.configure(enabled: false, geofences: [])
        XCTAssertThrowsError(try restored.configure(enabled: true, geofences: []))
        XCTAssertTrue(restored.userPaused)
        try restored.configure(enabled: true, geofences: [], userPaused: false)
        XCTAssertTrue(restored.enabled)
        XCTAssertFalse(try GuardianEventStore(fileURL: url).userPaused)
        try restored.clearLocalData()
        XCTAssertTrue(try GuardianEventStore(fileURL: url).userPaused)
    }

    func testClockRollbackRebasesInactivityWithoutInventingRecovery() {
        let now = Date()
        let future = now.addingTimeInterval(3600)
        var state = GuardianInactivityState()
        state.leaveHome(at: future)
        XCTAssertTrue(state.evaluate(at: future.addingTimeInterval(60), thresholdMinutes: 1))
        XCTAssertTrue(state.reconcileClock(at: now))
        XCTAssertEqual(state.awaySince, now)
        XCTAssertEqual(state.lastMovementAt, now)
        XCTAssertNil(state.lastTrustedLocationAt)
        XCTAssertEqual(state.alertEmittedAt, now)
        XCTAssertFalse(state.observeMovement(at: now.addingTimeInterval(-1)))
        XCTAssertFalse(state.reconcileClock(at: now.addingTimeInterval(1)))
        XCTAssertTrue(state.observeMovement(at: now.addingTimeInterval(2)))
        XCTAssertFalse(state.evaluate(at: now.addingTimeInterval(61), thresholdMinutes: 1))
        XCTAssertTrue(state.evaluate(at: now.addingTimeInterval(62), thresholdMinutes: 1))
    }

    func testClockRollbackDropsFutureGPSOrderingAnchorButNotNormalHistory() {
        let now = Date()
        let future = location(time: now.addingTimeInterval(3600))
        let fresh = location(time: now)
        XCTAssertNil(GuardianLocationPolicy.chronologicalAnchor(future, now: now))
        XCTAssertTrue(GuardianLocationPolicy.accepts(fresh, now: now))
        XCTAssertFalse(GuardianLocationPolicy.indicatesMotion(
            from: GuardianLocationPolicy.chronologicalAnchor(future, now: now), to: fresh))
        let old = location(time: now.addingTimeInterval(-300))
        XCTAssertEqual(GuardianLocationPolicy.chronologicalAnchor(old, now: now)?.timestamp, old.timestamp)
    }

    func testClockRollbackReconcilesPersistedAnchorsAndIncidentTogether() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = directory.appendingPathComponent("state.json")
        let store = try GuardianEventStore(fileURL: url)
        let now = Date(), future = Date().addingTimeInterval(3600)
        var inactivity = GuardianInactivityState()
        inactivity.leaveHome(at: future)
        XCTAssertTrue(inactivity.evaluate(at: future.addingTimeInterval(60), thresholdMinutes: 1))
        try store.setMovementAnchor(GuardianMovementAnchor(location(time: future)))
        let risk = GuardianEvent(type: .noMotionForLongTime, title: "风险", description: "测试",
            timestamp: future.addingTimeInterval(60), source: "motion")
        try store.append(risk, updatingInactivity: inactivity)
        let restored = try GuardianEventStore(fileURL: url)
        XCTAssertTrue(try restored.reconcileClock(at: now))
        XCTAssertNil(restored.movementAnchor)
        XCTAssertNil(restored.inactivity.lastTrustedLocationAt)
        XCTAssertEqual(restored.activeInactivityIncidentAt, now)
        XCTAssertEqual(restored.activeInactivityIncidentEventId, risk.id)
        XCTAssertTrue(restored.hasUnresolvedInactivityIncident)
        let reloaded = try GuardianEventStore(fileURL: url)
        XCTAssertFalse(try reloaded.reconcileClock(at: now))
        XCTAssertTrue(reloaded.hasUnresolvedInactivityIncident)
        try reloaded.append(GuardianEvent(type: .motionDetected, title: "恢复活动", description: "测试",
            timestamp: now.addingTimeInterval(1), source: "motion"))
        XCTAssertFalse(reloaded.hasUnresolvedInactivityIncident)
    }

    @MainActor
    func testAcceptedSendWithResultWriteFailureNeverCompletesAsSendFailure() async throws {
        for failAfterWrite in [false, true] {
            let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
            defer { try? FileManager.default.removeItem(at: directory) }
            let url = directory.appendingPathComponent("state.json")
            let store = try GuardianEventStore(fileURL: url)
            let contact = try GuardianNotificationContact(dictionary: [
                "id": "family", "name": "家人", "phone": "+8613800000000", "priority": 1])
            try store.setNotificationContacts([contact])
            try store.setMonitoringPolicy(GuardianMonitoringPolicy(mode: .standard), activeWindow: nil)
            let date = riskCheck(0, battery: 10).date
            _ = try store.evaluateRisks(riskCheck(0, battery: 10), detectionContext: "background")
            try store.updateCriticalMessagingAuthorizations([contact.applePhoneNumber: "approved"], at: date)
            let candidate = try XCTUnwrap(store.readyCriticalMessageOperations(at: date).first)
            _ = try XCTUnwrap(store.beginCriticalMessageAttempt(id: candidate.id, at: date))
            var sends = 0, completions = 0
            do {
                try await GuardianCriticalMessageAttempt.perform(send: {
                    sends += 1
                    return true
                }, complete: { result in
                    completions += 1
                    let accepted = try result.get()
                    XCTAssertTrue(accepted)
                    if failAfterWrite {
                        try store.completeCriticalMessageAttempt(id: candidate.id, accepted: accepted, at: date)
                    }
                    throw NSError(domain: "SyntheticResultWriteFailure", code: 1)
                })
                XCTFail("A result-write error must propagate, not become a retryable send error")
            } catch { XCTAssertEqual((error as NSError).domain, "SyntheticResultWriteFailure") }
            XCTAssertEqual(sends, 1)
            XCTAssertEqual(completions, 1)
            let reloaded = try GuardianEventStore(fileURL: url)
            _ = try reloaded.reconcileCriticalMessages(at: date.addingTimeInterval(180))
            let result = try XCTUnwrap(reloaded.criticalMessageOperations.first)
            XCTAssertEqual(result.status, failAfterWrite ? .accepted : .failed)
            if !failAfterWrite { XCTAssertEqual(result.lastErrorCode, "resultUnknown") }
            XCTAssertTrue(reloaded.readyCriticalMessageOperations(at: date.addingTimeInterval(600)).isEmpty)
        }
    }

    @MainActor
    func testTransportFailureIsCompletedExactlyOnce() async throws {
        var completions = 0
        try await GuardianCriticalMessageAttempt.perform(send: {
            throw NSError(domain: "SyntheticTransportFailure", code: 1)
        }, complete: { result in
            completions += 1
            guard case .failure(let error) = result else { return XCTFail("Expected transport failure") }
            XCTAssertEqual((error as NSError).domain, "SyntheticTransportFailure")
        })
        XCTAssertEqual(completions, 1)
    }

    func testTwoQueuedRisksRecheckCooldownAtSendTimeAndAcceptedCannotRegress() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = try GuardianEventStore(fileURL: directory.appendingPathComponent("state.json"))
        let first = try GuardianNotificationContact(dictionary: [
            "id": "first", "name": "家人一", "phone": "+8613800000000", "priority": 1])
        let second = try GuardianNotificationContact(dictionary: [
            "id": "second", "name": "家人二", "phone": "+8613900000000", "priority": 2])
        try store.setNotificationContacts([first, second])
        try store.setMonitoringPolicy(GuardianMonitoringPolicy(mode: .standard), activeWindow: nil)
        let check = riskCheck(0, battery: 10, blocker: .locationPermissionDisabled)
        _ = try store.evaluateRisks(check, detectionContext: "background")
        try store.updateCriticalMessagingAuthorizations([
            first.applePhoneNumber: "approved", second.applePhoneNumber: "approved"], at: check.date)
        let operations = store.readyCriticalMessageOperations(at: check.date)
        XCTAssertEqual(operations.count, 4)
        let pair = operations.filter { $0.contactId == first.id }
        XCTAssertEqual(pair.count, 2)
        _ = try XCTUnwrap(store.beginCriticalMessageAttempt(id: pair[0].id, at: check.date))
        try store.completeCriticalMessageAttempt(id: pair[0].id, accepted: true, at: check.date)
        try store.completeCriticalMessageAttempt(id: pair[0].id, accepted: false,
            errorCode: "storageError", retryable: true, at: check.date.addingTimeInterval(1))
        XCTAssertEqual(store.criticalMessageOperations.first { $0.id == pair[0].id }?.status, .accepted)
        XCTAssertNil(try store.beginCriticalMessageAttempt(id: pair[1].id, at: check.date))
        let waiting = try XCTUnwrap(store.criticalMessageOperations.first { $0.id == pair[1].id })
        XCTAssertEqual(waiting.attemptCount, 0)
        XCTAssertEqual(waiting.nextAttemptAt, check.date.addingTimeInterval(600))
        let other = try XCTUnwrap(operations.first { $0.contactId == second.id })
        XCTAssertNotNil(try store.beginCriticalMessageAttempt(id: other.id, at: check.date))
        XCTAssertNil(try store.beginCriticalMessageAttempt(id: pair[1].id, at: check.date.addingTimeInterval(599)))
        XCTAssertNotNil(try store.beginCriticalMessageAttempt(id: pair[1].id, at: check.date.addingTimeInterval(600)))
    }

    func testCooldownDoesNotDelaySameIncidentRetryButExtendsOtherQueuedRisk() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = try GuardianEventStore(fileURL: directory.appendingPathComponent("state.json"))
        let contact = try GuardianNotificationContact(dictionary: [
            "id": "family", "name": "家人", "phone": "+8613800000000", "priority": 1])
        try store.setNotificationContacts([contact])
        try store.setMonitoringPolicy(GuardianMonitoringPolicy(mode: .standard), activeWindow: nil)
        let check = riskCheck(0, battery: 10, blocker: .locationPermissionDisabled)
        _ = try store.evaluateRisks(check, detectionContext: "background")
        try store.updateCriticalMessagingAuthorizations([contact.applePhoneNumber: "approved"], at: check.date)
        let operations = store.readyCriticalMessageOperations(at: check.date)
        XCTAssertEqual(operations.count, 2)
        _ = try XCTUnwrap(store.beginCriticalMessageAttempt(id: operations[0].id, at: check.date))
        try store.completeCriticalMessageAttempt(id: operations[0].id, accepted: false,
            retryable: true, at: check.date)
        XCTAssertNil(try store.beginCriticalMessageAttempt(id: operations[1].id, at: check.date))
        XCTAssertNotNil(try store.beginCriticalMessageAttempt(id: operations[0].id, at: check.date.addingTimeInterval(60)))
        XCTAssertNil(try store.beginCriticalMessageAttempt(id: operations[1].id, at: check.date.addingTimeInterval(600)))
        XCTAssertEqual(store.criticalMessageOperations.first { $0.id == operations[1].id }?.nextAttemptAt,
                       check.date.addingTimeInterval(660))
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
        XCTAssertEqual(restored.criticalMessageOperations.first?.shortcutAttemptPending, false)
        XCTAssertNil(restored.criticalMessageOperations.first?.shortcutAttemptedAt)
        XCTAssertNil(restored.criticalMessageOperations.first?.shortcutOpenSucceeded)
    }

    func testCriticalMessagingRetriesPerContactAndStopsAfterThreeAttempts() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = try GuardianEventStore(fileURL: directory.appendingPathComponent("state.json"))
        try store.setMonitoringPolicy(GuardianMonitoringPolicy(mode: .standard), activeWindow: nil)
        let startedAt = Date(timeIntervalSince1970: 1_800_000_000)
        var inactivity = GuardianInactivityState()
        inactivity.leaveHome(at: startedAt)
        XCTAssertTrue(inactivity.evaluate(at: startedAt.addingTimeInterval(60), thresholdMinutes: 1))
        let risk = GuardianEvent(
            type: .noMotionForLongTime,
            title: "测试风险",
            description: "测试",
            timestamp: startedAt.addingTimeInterval(60),
            source: "motion"
        )
        let contact = try GuardianNotificationContact(dictionary: [
            "id": "family", "name": "家人", "phone": "+8613800000000", "priority": 1
        ])
        try store.setNotificationContacts([contact])
        try store.append(
            risk,
            updatingInactivity: inactivity,
            criticalMessages: GuardianCriticalMessageOperation.prepare(
                for: risk,
                contacts: [contact],
                thresholdMinutes: 1
            )
        )
        try store.updateCriticalMessagingAuthorizations(
            [contact.applePhoneNumber: "approved"],
            at: risk.timestamp
        )

        let operationId = try XCTUnwrap(store.criticalMessageOperations.first?.id)
        XCTAssertEqual(store.readyCriticalMessageOperations(at: risk.timestamp).map(\.id), [operationId])

        let first = try XCTUnwrap(store.beginCriticalMessageAttempt(id: operationId, at: risk.timestamp))
        XCTAssertEqual(first.status, .sending)
        XCTAssertEqual(first.attemptCount, 1)
        try store.completeCriticalMessageAttempt(
            id: operationId,
            accepted: false,
            errorCode: "sendFailed",
            errorMessage: "暂时失败",
            retryable: true,
            at: risk.timestamp
        )
        XCTAssertEqual(store.criticalMessageOperations.first?.status, .retryScheduled)
        XCTAssertEqual(
            store.criticalMessageOperations.first?.nextAttemptAt,
            risk.timestamp.addingTimeInterval(60)
        )
        XCTAssertTrue(store.readyCriticalMessageOperations(at: risk.timestamp).isEmpty)

        let secondAt = risk.timestamp.addingTimeInterval(61)
        XCTAssertNotNil(try store.beginCriticalMessageAttempt(id: operationId, at: secondAt))
        try store.completeCriticalMessageAttempt(
            id: operationId,
            accepted: false,
            errorCode: "sendFailed",
            errorMessage: "再次失败",
            retryable: true,
            at: secondAt
        )
        XCTAssertEqual(
            store.criticalMessageOperations.first?.nextAttemptAt,
            secondAt.addingTimeInterval(5 * 60)
        )

        let thirdAt = secondAt.addingTimeInterval(5 * 60 + 1)
        XCTAssertNotNil(try store.beginCriticalMessageAttempt(id: operationId, at: thirdAt))
        try store.completeCriticalMessageAttempt(
            id: operationId,
            accepted: false,
            errorCode: "sendFailed",
            errorMessage: "最终失败",
            retryable: true,
            at: thirdAt
        )
        XCTAssertEqual(store.criticalMessageOperations.first?.status, .failed)
        XCTAssertEqual(store.criticalMessageOperations.first?.attemptCount, 3)
        XCTAssertNil(store.criticalMessageOperations.first?.nextAttemptAt)
    }

    func testCriticalMessagingCancelsWhenRiskRecoversAndNeverReplaysOnOpen() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = directory.appendingPathComponent("state.json")
        let store = try GuardianEventStore(fileURL: url)
        let startedAt = Date(timeIntervalSince1970: 1_800_000_000)
        var inactivity = GuardianInactivityState()
        inactivity.leaveHome(at: startedAt)
        XCTAssertTrue(inactivity.evaluate(at: startedAt.addingTimeInterval(60), thresholdMinutes: 1))
        let risk = GuardianEvent(type: .noMotionForLongTime, title: "风险", description: "测试",
            timestamp: startedAt.addingTimeInterval(60), source: "motion")
        let contact = try GuardianNotificationContact(dictionary: [
            "id": "family", "name": "家人", "phone": "+8613800000000", "priority": 1
        ])
        try store.setNotificationContacts([contact])
        try store.append(risk, updatingInactivity: inactivity, criticalMessages:
            GuardianCriticalMessageOperation.prepare(for: risk, contacts: [contact], thresholdMinutes: 1))
        try store.append(GuardianEvent(
            type: .motionDetected,
            title: "重新检测到活动",
            description: "测试",
            timestamp: risk.timestamp.addingTimeInterval(10),
            source: "pedometer"
        ))

        XCTAssertEqual(store.criticalMessageOperations.first?.status, .cancelled)
        XCTAssertEqual(store.criticalMessageOperations.first?.lastErrorCode, "riskResolved")
        let restored = try GuardianEventStore(fileURL: url)
        XCTAssertEqual(restored.criticalMessageOperations.first?.status, .cancelled)
        XCTAssertTrue(restored.readyCriticalMessageOperations(at: risk.timestamp.addingTimeInterval(20)).isEmpty)
    }

    func testCriticalMessagingExpiresAndUnknownSendingResultDoesNotRetry() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = try GuardianEventStore(fileURL: directory.appendingPathComponent("state.json"))
        try store.setMonitoringPolicy(GuardianMonitoringPolicy(mode: .standard), activeWindow: nil)
        let startedAt = Date(timeIntervalSince1970: 1_800_000_000)
        var inactivity = GuardianInactivityState()
        inactivity.leaveHome(at: startedAt)
        XCTAssertTrue(inactivity.evaluate(at: startedAt.addingTimeInterval(60), thresholdMinutes: 1))
        let risk = GuardianEvent(type: .noMotionForLongTime, title: "风险", description: "测试",
            timestamp: startedAt.addingTimeInterval(60), source: "motion")
        let contact = try GuardianNotificationContact(dictionary: [
            "id": "family", "name": "家人", "phone": "+8613800000000", "priority": 1
        ])
        try store.setNotificationContacts([contact])
        try store.append(risk, updatingInactivity: inactivity, criticalMessages:
            GuardianCriticalMessageOperation.prepare(for: risk, contacts: [contact], thresholdMinutes: 1))
        try store.updateCriticalMessagingAuthorizations([contact.applePhoneNumber: "approved"], at: risk.timestamp)
        let operationId = try XCTUnwrap(store.criticalMessageOperations.first?.id)
        XCTAssertNotNil(try store.beginCriticalMessageAttempt(id: operationId, at: risk.timestamp))
        try store.reconcileCriticalMessages(
            at: risk.timestamp.addingTimeInterval(GuardianCriticalMessagingPolicy.sendingLease + 1)
        )
        XCTAssertEqual(store.criticalMessageOperations.first?.status, .failed)
        XCTAssertEqual(store.criticalMessageOperations.first?.lastErrorCode, "resultUnknown")

        let secondRisk = GuardianEvent(type: .noMotionForLongTime, title: "风险2", description: "测试",
            timestamp: risk.timestamp.addingTimeInterval(60 * 60), source: "motion")
        var secondInactivity = GuardianInactivityState()
        secondInactivity.leaveHome(at: secondRisk.timestamp.addingTimeInterval(-60))
        XCTAssertTrue(secondInactivity.evaluate(at: secondRisk.timestamp, thresholdMinutes: 1))
        try store.append(GuardianEvent(type: .motionDetected, title: "恢复", description: "测试",
            timestamp: risk.timestamp.addingTimeInterval(10 * 60), source: "motion"))
        try store.append(secondRisk, updatingInactivity: secondInactivity, criticalMessages:
            GuardianCriticalMessageOperation.prepare(for: secondRisk, contacts: [contact], thresholdMinutes: 1))
        try store.reconcileCriticalMessages(at: secondRisk.timestamp.addingTimeInterval(31 * 60))
        XCTAssertEqual(store.criticalMessageOperations.last?.status, .expired)
    }

    func testCriticalMessagingTracksAuthorizationPerContactAndAppliesCooldown() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = try GuardianEventStore(fileURL: directory.appendingPathComponent("state.json"))
        try store.setMonitoringPolicy(GuardianMonitoringPolicy(mode: .standard), activeWindow: nil)
        let startedAt = Date(timeIntervalSince1970: 1_800_000_000)
        let first = try GuardianNotificationContact(dictionary: [
            "id": "first", "name": "第一位", "phone": "+8613800000000", "priority": 1
        ])
        let second = try GuardianNotificationContact(dictionary: [
            "id": "second", "name": "第二位", "phone": "+8613900000000", "priority": 2
        ])
        try store.setNotificationContacts([first, second])
        var inactivity = GuardianInactivityState()
        inactivity.leaveHome(at: startedAt)
        XCTAssertTrue(inactivity.evaluate(at: startedAt.addingTimeInterval(60), thresholdMinutes: 1))
        let risk = GuardianEvent(type: .noMotionForLongTime, title: "风险", description: "测试",
            timestamp: startedAt.addingTimeInterval(60), source: "motion")
        try store.append(risk, updatingInactivity: inactivity, criticalMessages:
            GuardianCriticalMessageOperation.prepare(for: risk, contacts: [first, second], thresholdMinutes: 1))
        try store.updateCriticalMessagingAuthorizations([
            first.applePhoneNumber: "approved",
            second.applePhoneNumber: "denied"
        ], at: risk.timestamp)
        XCTAssertEqual(store.readyCriticalMessageOperations(at: risk.timestamp).map(\.contactId), [first.id])
        XCTAssertEqual(
            store.criticalMessageOperations.first(where: { $0.contactId == second.id })?.status,
            .restricted
        )

        let firstOperation = try XCTUnwrap(
            store.criticalMessageOperations.first(where: { $0.contactId == first.id })
        )
        XCTAssertNotNil(try store.beginCriticalMessageAttempt(id: firstOperation.id, at: risk.timestamp))
        try store.completeCriticalMessageAttempt(id: firstOperation.id, accepted: true, at: risk.timestamp)
        try store.append(GuardianEvent(type: .motionDetected, title: "恢复", description: "测试",
            timestamp: risk.timestamp.addingTimeInterval(60), source: "motion"))

        var nextInactivity = GuardianInactivityState()
        nextInactivity.leaveHome(at: risk.timestamp.addingTimeInterval(4 * 60))
        XCTAssertTrue(nextInactivity.evaluate(
            at: risk.timestamp.addingTimeInterval(5 * 60),
            thresholdMinutes: 1
        ))
        let nextRisk = GuardianEvent(type: .noMotionForLongTime, title: "风险2", description: "测试",
            timestamp: risk.timestamp.addingTimeInterval(5 * 60), source: "motion")
        try store.append(nextRisk, updatingInactivity: nextInactivity, criticalMessages:
            GuardianCriticalMessageOperation.prepare(for: nextRisk, contacts: [first], thresholdMinutes: 1))
        let nextOperation = try XCTUnwrap(store.criticalMessageOperations.last)
        XCTAssertEqual(nextOperation.status, .retryScheduled)
        XCTAssertEqual(
            nextOperation.cooldownUntil,
            risk.timestamp.addingTimeInterval(GuardianCriticalMessagingPolicy.cooldownInterval)
        )
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
        XCTAssertEqual(migrated?["version"] as? Int, 6)
        XCTAssertEqual(restored.monitoringPolicy.mode, .test)
    }

    private func riskCheck(_ seconds: TimeInterval, battery: Int? = 80, charging: Bool? = false,
                           home: GuardianHomePresence = .away, expected: Bool = true,
                           blocker: GuardianLocationRiskReason? = nil, fix: TimeInterval? = nil,
                           failed: Bool = false) -> GuardianRiskCheck {
        let base = Date(timeIntervalSince1970: 1_800_000_000)
        return GuardianRiskCheck(date: base.addingTimeInterval(seconds), enabled: true,
            homePresence: home, expectsLocation: expected, locationBlocker: blocker,
            batteryLevel: battery, isCharging: charging,
            trustedLocationAt: fix.map { base.addingTimeInterval($0) }, locationFailed: failed)
    }

    func testProductionRejectsShortFractionalAndBooleanThresholds() throws {
        XCTAssertThrowsError(try GuardianMonitoringPolicy(mode: .standard,
            noMotionThresholdMinutes: 1).validate())
        XCTAssertThrowsError(try GuardianMonitoringPolicy(mode: .standard,
            locationLostThresholdMinutes: 1).validate())
        XCTAssertNoThrow(try GuardianMonitoringPolicy(noMotionThresholdMinutes: 1,
            locationLostThresholdMinutes: 1).validate())
        for invalid in [NSNumber(value: true), NSNumber(value: 1.5), NSNumber(value: 241)] {
            XCTAssertThrowsError(try GuardianMonitoringPolicy(dictionary: [
                "monitoringMode": "test", "noMotionThresholdMinutes": invalid,
                "locationLostThresholdMinutes": 120
            ]))
        }
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = try GuardianEventStore(fileURL: directory.appendingPathComponent("state.json"))
        try store.setMonitoringPolicy(GuardianMonitoringPolicy(mode: .standard), activeWindow: nil)
        XCTAssertThrowsError(try store.setNoMotionThresholdMinutes(1))
        XCTAssertEqual(store.noMotionThresholdMinutes, 120)
    }

    func testBatteryUnknownAndHomeDoNotCreateRiskAndChargingResolvesOnce() {
        var state = GuardianRiskState()
        let policy = GuardianMonitoringPolicy()
        XCTAssertTrue(state.evaluate(riskCheck(0, battery: nil, expected: false), policy: policy).isEmpty)
        XCTAssertTrue(state.evaluate(riskCheck(1, battery: -1, expected: false), policy: policy).isEmpty)
        XCTAssertTrue(state.evaluate(riskCheck(2, battery: 10, charging: nil, expected: false), policy: policy).isEmpty)
        XCTAssertTrue(state.evaluate(riskCheck(3, battery: 10, home: .home, expected: false), policy: policy).isEmpty)
        XCTAssertEqual(state.evaluate(riskCheck(4, battery: 19, expected: false), policy: policy), [.lowBattery])
        XCTAssertTrue(state.evaluate(riskCheck(5, battery: 0, expected: false), policy: policy).isEmpty)
        XCTAssertEqual(state.evaluate(riskCheck(6, battery: 5, charging: true, expected: false), policy: policy), [.batteryRecovered])
        XCTAssertTrue(state.evaluate(riskCheck(7, battery: 5, charging: true, expected: false), policy: policy).isEmpty)
        XCTAssertEqual(state.evaluate(riskCheck(8, battery: 5, expected: false), policy: policy), [.lowBattery])
        XCTAssertEqual(state.evaluate(riskCheck(9, battery: 20, expected: false), policy: policy), [.batteryRecovered])
    }

    func testLocationDeadlineRecoveryRestAndPermissionCauses() {
        var state = GuardianRiskState()
        let policy = GuardianMonitoringPolicy(locationLostThresholdMinutes: 1)
        XCTAssertTrue(state.evaluate(riskCheck(0, fix: 0), policy: policy).isEmpty)
        XCTAssertTrue(state.evaluate(riskCheck(59), policy: policy).isEmpty)
        XCTAssertEqual(state.evaluate(riskCheck(60), policy: policy), [.locationLost(.locationStale)])
        XCTAssertTrue(state.evaluate(riskCheck(100), policy: policy).isEmpty)
        XCTAssertEqual(state.evaluate(riskCheck(101, fix: 101), policy: policy), [.locationRestored])
        XCTAssertTrue(state.evaluate(riskCheck(102, expected: false), policy: policy).isEmpty)
        XCTAssertTrue(state.evaluate(riskCheck(1000, expected: false), policy: policy).isEmpty)
        XCTAssertTrue(state.evaluate(riskCheck(1001), policy: policy).isEmpty)
        XCTAssertEqual(state.evaluate(riskCheck(1002, blocker: .preciseLocationDisabled),
            policy: policy), [.locationLost(.preciseLocationDisabled)])
        XCTAssertTrue(state.evaluate(riskCheck(1003, blocker: .backgroundRefreshDisabled),
            policy: policy).isEmpty)
        XCTAssertEqual(state.locationReason, .backgroundRefreshDisabled)
        // Restoring a permission alone is not a fresh position.
        XCTAssertTrue(state.evaluate(riskCheck(1004), policy: policy).isEmpty)
        XCTAssertNotNil(state.locationReason)
        XCTAssertEqual(state.evaluate(riskCheck(1005, fix: 1005), policy: policy), [.locationRestored])
        var capabilities = GuardianRiskState()
        let longPolicy = GuardianMonitoringPolicy()
        _ = capabilities.evaluate(riskCheck(0, blocker: .backgroundRefreshDisabled, fix: 0),
            policy: longPolicy)
        // An old sample collected while blocked cannot falsely certify recovery.
        XCTAssertTrue(capabilities.evaluate(riskCheck(600), policy: longPolicy).isEmpty)
        XCTAssertNotNil(capabilities.locationReason)
        XCTAssertEqual(capabilities.evaluate(riskCheck(601, fix: 601),
            policy: longPolicy), [.locationRestored])
    }

    func testLocationFailureAndRejectedOrFutureSamplesDoNotRenewDeadline() {
        var state = GuardianRiskState()
        let policy = GuardianMonitoringPolicy(locationLostThresholdMinutes: 1)
        _ = state.evaluate(riskCheck(0), policy: policy)
        XCTAssertTrue(state.evaluate(riskCheck(10, failed: true), policy: policy).isEmpty)
        _ = state.evaluate(riskCheck(20, fix: 200), policy: policy)
        XCTAssertNil(state.lastTrustedLocationAt)
        XCTAssertEqual(state.evaluate(riskCheck(60), policy: policy), [.locationLost(.locationFailed)])
        _ = state.evaluate(riskCheck(200, fix: 0), policy: policy)
        XCTAssertNotNil(state.locationReason)
        XCTAssertEqual(state.evaluate(riskCheck(201, fix: 201), policy: policy), [.locationRestored])
    }

    func testDetectorStateSurvivesSerializationAndClockRollback() throws {
        var state = GuardianRiskState()
        let policy = GuardianMonitoringPolicy(locationLostThresholdMinutes: 1)
        _ = state.evaluate(riskCheck(100, battery: 10, fix: 100), policy: policy)
        let data = try JSONEncoder().encode(state)
        var restored = try JSONDecoder().decode(GuardianRiskState.self, from: data)
        XCTAssertTrue(restored.evaluate(riskCheck(120, battery: 10), policy: policy).isEmpty)
        XCTAssertTrue(restored.evaluate(riskCheck(0, battery: 10), policy: policy).isEmpty)
        XCTAssertNil(restored.lastTrustedLocationAt)
        XCTAssertEqual(restored.evaluate(riskCheck(60, battery: 10), policy: policy), [.locationLost(.locationStale)])
    }

    func testRiskEventsAndRecipientsAreAtomicAndDeduplicateAcrossReload() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = directory.appendingPathComponent("state.json")
        let store = try GuardianEventStore(fileURL: url)
        let contact = try GuardianNotificationContact(dictionary: [
            "id": "family", "name": "家人", "phone": "+8613800000000", "priority": 1
        ])
        try store.setNotificationContacts([contact])
        let first = try store.evaluateRisks(riskCheck(0, battery: 10,
            blocker: .locationPermissionDisabled), detectionContext: "background")
        XCTAssertEqual(first.map(\.type), [.lowBattery, .locationLost])
        XCTAssertTrue(first.allSatisfy { $0.isTest == true && $0.title.contains("测试") })
        XCTAssertEqual(store.criticalMessageOperations.count, 2)
        XCTAssertTrue(store.criticalMessageOperations.allSatisfy { $0.isTest == true && $0.messageText.contains("测试") })
        try store.acknowledge(Set(first.map(\.id)))
        let restored = try GuardianEventStore(fileURL: url)
        XCTAssertTrue(try restored.evaluateRisks(riskCheck(10, battery: 10,
            blocker: .locationPermissionDisabled), detectionContext: "restoration").isEmpty)
        XCTAssertTrue(restored.pendingEvents.isEmpty)
        XCTAssertEqual(restored.criticalMessageOperations.count, 2)
        try restored.updateCriticalMessagingAuthorizations([contact.applePhoneNumber: "approved"],
            at: riskCheck(10).date)
        XCTAssertTrue(restored.readyCriticalMessageOperations(at: riskCheck(10).date).isEmpty)
        for operation in restored.criticalMessageOperations {
            XCTAssertNil(try restored.beginCriticalMessageAttempt(id: operation.id, at: riskCheck(10).date))
        }
        let recovered = try restored.evaluateRisks(riskCheck(11, battery: 10, charging: true, fix: 11),
            detectionContext: "foreground")
        XCTAssertEqual(recovered.map(\.type), [.batteryRecovered, .locationRestored])
        XCTAssertTrue(restored.criticalMessageOperations.allSatisfy { $0.status == .cancelled })
    }

    func testModeChangeCancelsTestOperationsAndRestartsDetectors() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = try GuardianEventStore(fileURL: directory.appendingPathComponent("state.json"))
        let contact = try GuardianNotificationContact(dictionary: [
            "id": "family", "name": "家人", "phone": "+8613800000000", "priority": 1
        ])
        try store.setNotificationContacts([contact])
        _ = try store.evaluateRisks(riskCheck(0, battery: 10), detectionContext: "foreground")
        let testOperation = try XCTUnwrap(store.criticalMessageOperations.first)
        try store.setMonitoringPolicy(GuardianMonitoringPolicy(mode: .standard), activeWindow: nil)
        XCTAssertFalse(store.riskState.lowBatteryActive)
        XCTAssertEqual(store.criticalMessageOperations.first?.status, .cancelled)
        XCTAssertEqual(store.pendingEvents.last?.type, .guardianSessionReset)
        _ = try store.evaluateRisks(riskCheck(10, battery: 10), detectionContext: "background")
        try store.updateCriticalMessagingAuthorizations([contact.applePhoneNumber: "approved"], at: riskCheck(10).date)
        XCTAssertNil(try store.beginCriticalMessageAttempt(id: testOperation.id, at: riskCheck(10).date))
        XCTAssertEqual(store.readyCriticalMessageOperations(at: riskCheck(10).date).count, 1)
        XCTAssertEqual(store.criticalMessageOperations.last?.isTest, false)
        let locationOp = GuardianCriticalMessageOperation.prepare(for: GuardianEvent(type: .locationLost,
            title: "位置", description: "精确位置已关闭", timestamp: Date(), source: "location"),
            contacts: [contact], thresholdMinutes: 120)[0]
        XCTAssertTrue(locationOp.messageText.contains("精确位置已关闭"))
        XCTAssertFalse(locationOp.messageText.contains("没有明显活动"))
    }

    func testFailedRiskCommitDoesNotAdvanceDeduplicationState() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let parent = directory.appendingPathComponent("blocked")
        let store = try GuardianEventStore(fileURL: parent.appendingPathComponent("state.json"))
        try Data("not a directory".utf8).write(to: parent)
        XCTAssertThrowsError(try store.evaluateRisks(riskCheck(0, battery: 10), detectionContext: "background"))
        XCTAssertFalse(store.riskState.lowBatteryActive)
        XCTAssertTrue(store.pendingEvents.isEmpty)
        try FileManager.default.removeItem(at: parent)
        XCTAssertEqual(try store.evaluateRisks(riskCheck(1, battery: 10),
            detectionContext: "background").map(\.type), [.lowBattery])
    }

    func testVersionFiveShortThresholdMigratesToTestAndCancelsLegacyQueue() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = directory.appendingPathComponent("state.json")
        let store = try GuardianEventStore(fileURL: url)
        try store.setNoMotionThresholdMinutes(1)
        let contact = try GuardianNotificationContact(dictionary: [
            "id": "family", "name": "家人", "phone": "+8613800000000", "priority": 1
        ])
        try store.setNotificationContacts([contact])
        var inactivity = GuardianInactivityState()
        let date = Date()
        inactivity.leaveHome(at: date.addingTimeInterval(-60))
        XCTAssertTrue(inactivity.evaluate(at: date, thresholdMinutes: 1))
        let risk = GuardianEvent(type: .noMotionForLongTime, title: "旧告警", description: "旧告警",
            timestamp: date, source: "motion")
        try store.append(risk, updatingInactivity: inactivity, criticalMessages:
            GuardianCriticalMessageOperation.prepare(for: risk, contacts: [contact], thresholdMinutes: 1))
        var raw = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
        raw["version"] = 5
        raw.removeValue(forKey: "monitoringPolicy")
        raw.removeValue(forKey: "riskState")
        raw.removeValue(forKey: "activeRiskEventIds")
        try JSONSerialization.data(withJSONObject: raw).write(to: url)
        let migrated = try GuardianEventStore(fileURL: url)
        XCTAssertEqual(migrated.monitoringPolicy.mode, .test)
        XCTAssertEqual(migrated.noMotionThresholdMinutes, 1)
        XCTAssertEqual(migrated.notificationContacts, [contact])
        XCTAssertTrue(migrated.pendingEvents.contains { $0.id == risk.id })
        XCTAssertEqual(migrated.pendingEvents.last?.type, .guardianSessionReset)
        XCTAssertFalse(migrated.hasUnresolvedInactivityIncident)
        XCTAssertTrue(migrated.criticalMessageOperations.allSatisfy { $0.status == .cancelled })
    }

    func testClearLocalDataErasesConfigurationRiskQueueAndAuthorizationsAcrossReload() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = directory.appendingPathComponent("state.json")
        let store = try GuardianEventStore(fileURL: url)
        let fence = try GuardianGeofence(dictionary: [
            "id": "home", "kind": "home", "name": "家", "radiusMeters": 150.0,
            "center": ["latitude": 30.0, "longitude": 120.0]
        ])
        let contact = try GuardianNotificationContact(dictionary: [
            "id": "family", "name": "家人", "phone": "+8613800000000", "priority": 1
        ])
        try store.configure(enabled: true, geofences: [fence], notificationContacts: [contact])
        try store.updateCriticalMessagingAuthorizations([contact.applePhoneNumber: "approved"])
        try store.setMovementAnchor(GuardianMovementAnchor(location(time: Date())))
        _ = try store.evaluateRisks(riskCheck(0, battery: 10, blocker: .locationPermissionDisabled),
                                   detectionContext: "background")
        XCTAssertFalse(store.pendingEvents.isEmpty)
        XCTAssertFalse(store.criticalMessageOperations.isEmpty)
        try store.clearLocalData()
        // Explicit clear must be idempotent after a JS completion-write failure.
        try store.clearLocalData()
        let restored = try GuardianEventStore(fileURL: url)
        XCTAssertFalse(restored.enabled)
        XCTAssertTrue(restored.geofences.isEmpty)
        XCTAssertTrue(restored.notificationContacts.isEmpty)
        XCTAssertTrue(restored.criticalMessagingAuthorizations.isEmpty)
        XCTAssertTrue(restored.pendingEvents.isEmpty)
        XCTAssertTrue(restored.criticalMessageOperations.isEmpty)
        XCTAssertEqual(restored.riskState, GuardianRiskState())
        XCTAssertNil(restored.movementAnchor)
        XCTAssertNil(restored.activeWindow)
        XCTAssertEqual(restored.monitoringPolicy.mode, .test)
        XCTAssertEqual(try directory.resourceValues(forKeys: [.isExcludedFromBackupKey]).isExcludedFromBackup, true)
    }

    func testFailedClearRetainsInMemoryStateAndSupportsRetry() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let parent = directory.appendingPathComponent("store")
        let held = directory.appendingPathComponent("held")
        let store = try GuardianEventStore(fileURL: parent.appendingPathComponent("state.json"))
        let event = GuardianEvent(type: .sosSent, title: "求助", description: "待处理",
                                  timestamp: Date(), source: "user")
        try store.append(event)
        try FileManager.default.moveItem(at: parent, to: held)
        try Data("blocked".utf8).write(to: parent)
        XCTAssertThrowsError(try store.clearLocalData())
        XCTAssertEqual(store.pendingEvents.map(\.id), [event.id])
        try FileManager.default.removeItem(at: parent)
        try FileManager.default.moveItem(at: held, to: parent)
        try store.clearLocalData()
        XCTAssertTrue(store.pendingEvents.isEmpty)
    }

    func testNativeDeletionIntentSurvivesRestartAndRejectsOldJSConfiguration() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = directory.appendingPathComponent("state.json")
        let store = try GuardianEventStore(fileURL: url)
        try store.configure(enabled: true, geofences: [])
        try store.beginDataDeletion()
        let restored = try GuardianEventStore(fileURL: url)
        XCTAssertTrue(restored.dataDeletionPending)
        XCTAssertFalse(restored.enabled)
        XCTAssertThrowsError(try restored.configure(enabled: true, geofences: []))
        XCTAssertThrowsError(try restored.setNotificationContacts([]))
        XCTAssertThrowsError(try restored.setMonitoringPolicy(GuardianMonitoringPolicy(), activeWindow: nil))
        XCTAssertTrue(try restored.evaluateRisks(riskCheck(0, battery: 10), detectionContext: "restoration").isEmpty)
        try restored.clearLocalData()
        XCTAssertFalse(try GuardianEventStore(fileURL: url).dataDeletionPending)
    }

    func testCorruptNativeFileIsUntouchedUntilExplicitDeletionIsRequested() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let url = directory.appendingPathComponent("state.json")
        let original = Data("corrupt-private-state".utf8)
        try original.write(to: url)
        XCTAssertThrowsError(try GuardianEventStore(fileURL: url))
        XCTAssertEqual(try Data(contentsOf: url), original)
        let deleting = try GuardianEventStore(fileURL: url, resettingForDeletion: true)
        XCTAssertTrue(deleting.dataDeletionPending)
        XCTAssertFalse(deleting.enabled)
        try deleting.clearLocalData()
        XCTAssertTrue(try GuardianEventStore(fileURL: url).pendingEvents.isEmpty)
    }

    func testMessageRetentionLimitsOnlyCompletedOperationsAndNeverDropsPendingEvents() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = try GuardianEventStore(fileURL: directory.appendingPathComponent("state.json"))
        let now = Date()
        let contact = try GuardianNotificationContact(dictionary: [
            "id": "family", "name": "家人", "phone": "+8613800000000", "priority": 1
        ])
        for index in 0..<110 {
            let event = GuardianEvent(type: .lowBattery, title: "历史", description: "历史",
                timestamp: now.addingTimeInterval(Double(index)), source: "battery")
            var operations = GuardianCriticalMessageOperation.prepare(for: event, contacts: [contact],
                                                                      thresholdMinutes: 120)
            operations[0].status = .cancelled
            try store.append(event, updatingInactivity: GuardianInactivityState(), criticalMessages: operations)
        }
        XCTAssertEqual(store.criticalMessageOperations.count, 100)
        XCTAssertEqual(store.pendingEvents.count, 110)
        let pending = GuardianEvent(type: .locationLost, title: "待处理", description: "待处理",
                                    timestamp: now, source: "location")
        try store.append(pending, updatingInactivity: GuardianInactivityState(),
            criticalMessages: GuardianCriticalMessageOperation.prepare(for: pending, contacts: [contact],
                                                                       thresholdMinutes: 120))
        XCTAssertEqual(store.criticalMessageOperations.count, 101)
        try store.pruneHistory(at: now.addingTimeInterval(31 * 24 * 60 * 60))
        XCTAssertEqual(store.criticalMessageOperations.map(\.eventId), [pending.id])
        XCTAssertEqual(store.pendingEvents.count, 111)
    }

    func testRetentionKeepsAnActiveRiskEvenWhenItsMessageIsTerminal() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = try GuardianEventStore(fileURL: directory.appendingPathComponent("state.json"))
        let contact = try GuardianNotificationContact(dictionary: [
            "id": "family", "name": "家人", "phone": "+8613800000000", "priority": 1
        ])
        try store.setNotificationContacts([contact])
        _ = try store.evaluateRisks(riskCheck(0, battery: 10), detectionContext: "foreground")
        let future = riskCheck(0).date.addingTimeInterval(40 * 24 * 60 * 60)
        _ = try store.reconcileCriticalMessages(at: future)
        XCTAssertEqual(store.criticalMessageOperations.first?.status, .expired)
        try store.pruneHistory(at: future.addingTimeInterval(40 * 24 * 60 * 60))
        XCTAssertEqual(store.criticalMessageOperations.count, 1)
        XCTAssertTrue(store.riskState.lowBatteryActive)
    }

    func testSleepingAcrossRestPeriodDoesNotCarryPositionTimeoutIntoNextDay() {
        var state = GuardianRiskState()
        let policy = GuardianMonitoringPolicy(locationLostThresholdMinutes: 1)
        _ = state.evaluate(riskCheck(0), policy: policy)
        XCTAssertEqual(state.evaluate(riskCheck(60), policy: policy), [.locationLost(.locationStale)])
        var nextDay = riskCheck(86_410)
        nextDay.activePeriodStart = riskCheck(86_400).date
        XCTAssertEqual(state.evaluate(nextDay, policy: policy), [.locationPeriodReset])
        XCTAssertNil(state.locationReason)
        XCTAssertTrue(state.evaluate(riskCheck(86_469), policy: policy).isEmpty)
        XCTAssertEqual(state.evaluate(riskCheck(86_470), policy: policy), [.locationLost(.locationStale)])
    }
}
