import Foundation

// Accessed on the main queue together with CLLocationManager and the RN bridge.
final class GuardianEventStore {
    private struct State: Codable {
        var version = 4
        var enabled = false
        var geofences: [GuardianGeofence] = []
        var events: [GuardianEvent] = []
        var noMotionThresholdMinutes = 120
        var activeWindow: GuardianActiveWindow?
        var inactivity = GuardianInactivityState()
        var notificationContacts: [GuardianNotificationContact] = []
        var criticalMessageOperations: [GuardianCriticalMessageOperation] = []
        var activeInactivityIncidentAt: Date?
        var movementAnchor: GuardianMovementAnchor?

        private enum CodingKeys: String, CodingKey {
            case version, enabled, geofences, events, noMotionThresholdMinutes, activeWindow, inactivity
            case notificationContacts, criticalMessageOperations
            case activeInactivityIncidentAt
            case movementAnchor
        }

        init() {}

        init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            version = try container.decodeIfPresent(Int.self, forKey: .version) ?? 1
            enabled = try container.decodeIfPresent(Bool.self, forKey: .enabled) ?? false
            geofences = try container.decodeIfPresent([GuardianGeofence].self, forKey: .geofences) ?? []
            events = try container.decodeIfPresent([GuardianEvent].self, forKey: .events) ?? []
            noMotionThresholdMinutes = try container.decodeIfPresent(Int.self, forKey: .noMotionThresholdMinutes) ?? 120
            activeWindow = try container.decodeIfPresent(GuardianActiveWindow.self, forKey: .activeWindow)
            inactivity = try container.decodeIfPresent(GuardianInactivityState.self, forKey: .inactivity) ?? GuardianInactivityState()
            notificationContacts = try container.decodeIfPresent([GuardianNotificationContact].self, forKey: .notificationContacts) ?? []
            criticalMessageOperations = try container.decodeIfPresent([GuardianCriticalMessageOperation].self, forKey: .criticalMessageOperations) ?? []
            activeInactivityIncidentAt = try container.decodeIfPresent(Date.self, forKey: .activeInactivityIncidentAt) ?? inactivity.alertEmittedAt
            movementAnchor = try container.decodeIfPresent(GuardianMovementAnchor.self, forKey: .movementAnchor)
        }
    }
    private let fileURL: URL
    private var state: State
    var enabled: Bool { state.enabled }
    var geofences: [GuardianGeofence] { state.geofences }
    var pendingEvents: [GuardianEvent] { state.events }
    var noMotionThresholdMinutes: Int { state.noMotionThresholdMinutes }
    var activeWindow: GuardianActiveWindow? { state.activeWindow }
    var inactivity: GuardianInactivityState { state.inactivity }
    var notificationContacts: [GuardianNotificationContact] { state.notificationContacts }
    var criticalMessageOperations: [GuardianCriticalMessageOperation] { state.criticalMessageOperations }
    var activeInactivityIncidentAt: Date? { state.activeInactivityIncidentAt }
    var hasUnresolvedInactivityIncident: Bool { state.activeInactivityIncidentAt != nil }
    var movementAnchor: GuardianMovementAnchor? { state.movementAnchor }

    func setMovementAnchor(_ value: GuardianMovementAnchor?) throws {
        var next = state
        next.movementAnchor = value
        try commit(next)
    }

    init(fileURL: URL? = nil) throws {
        if let fileURL { self.fileURL = fileURL }
        else {
            let directory = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
                .appendingPathComponent("GuardianCore", isDirectory: true)
            self.fileURL = directory.appendingPathComponent("state-v1.json")
        }
        if FileManager.default.fileExists(atPath: self.fileURL.path) {
            let decoder = JSONDecoder()
            decoder.dateDecodingStrategy = .millisecondsSince1970
            state = try decoder.decode(State.self, from: Data(contentsOf: self.fileURL))
            guard (1...4).contains(state.version) else { throw GuardianCoreError.unsupportedVersion }
            try GuardianGeofence.validate(state.geofences)
            try GuardianNotificationContact.validate(state.notificationContacts)
            try Self.validateThreshold(state.noMotionThresholdMinutes)
            if state.version < 4 {
                state.version = 4
                try commit(state)
            }
        } else { state = State() }
    }

    func configure(
        enabled: Bool,
        geofences: [GuardianGeofence],
        noMotionThresholdMinutes: Int? = nil,
        activeWindow: GuardianActiveWindow? = nil,
        notificationContacts: [GuardianNotificationContact]? = nil
    ) throws {
        try GuardianGeofence.validate(geofences)
        var next = state
        next.enabled = enabled
        if !enabled { next.activeInactivityIncidentAt = nil }
        next.geofences = geofences
        if let noMotionThresholdMinutes {
            try Self.validateThreshold(noMotionThresholdMinutes)
            next.noMotionThresholdMinutes = noMotionThresholdMinutes
        }
        if let activeWindow { next.activeWindow = activeWindow }
        if let notificationContacts {
            try GuardianNotificationContact.validate(notificationContacts)
            next.notificationContacts = notificationContacts
        }
        if !geofences.contains(where: { $0.kind == "home" }) {
            next.inactivity = GuardianInactivityState()
            next.activeInactivityIncidentAt = nil
        }
        try commit(next)
    }

    func setNoMotionThresholdMinutes(_ value: Int) throws {
        try Self.validateThreshold(value)
        var next = state
        next.noMotionThresholdMinutes = value
        try commit(next)
    }

    @discardableResult
    func setActiveWindow(_ value: GuardianActiveWindow) throws -> Bool {
        guard state.activeWindow != value else { return false }
        var next = state
        next.activeWindow = value
        try commit(next)
        return true
    }

    func setInactivity(_ value: GuardianInactivityState) throws {
        var next = state
        next.inactivity = value
        // A scheduled rest ends this monitoring period; a restoration does not.
        if value.homePresence == .away && value.awaySince == nil {
            next.activeInactivityIncidentAt = nil
        }
        try commit(next)
    }

    func setNotificationContacts(_ contacts: [GuardianNotificationContact]) throws {
        try GuardianNotificationContact.validate(contacts)
        var next = state
        next.notificationContacts = contacts
        try commit(next)
    }

    func beginShortcutAttempt(
        operationId: String,
        at date: Date
    ) throws -> GuardianCriticalMessageOperation? {
        guard let index = state.criticalMessageOperations.firstIndex(where: {
            $0.id == operationId && $0.status == .prepared &&
                $0.shortcutAttemptPending == true && $0.shortcutAttemptedAt == nil
        }) else { return nil }
        var next = state
        next.criticalMessageOperations[index].shortcutAttemptedAt = date
        try commit(next)
        return next.criticalMessageOperations[index]
    }

    func completeShortcutAttempt(
        operationId: String,
        succeeded: Bool?,
        error: String? = nil
    ) throws {
        guard let index = state.criticalMessageOperations.firstIndex(where: {
            $0.id == operationId && $0.shortcutAttemptedAt != nil
        }) else { return }
        var next = state
        next.criticalMessageOperations[index].shortcutAttemptPending = false
        next.criticalMessageOperations[index].shortcutOpenSucceeded = succeeded
        next.criticalMessageOperations[index].shortcutAttemptError = error
        try commit(next)
    }

    func append(_ event: GuardianEvent) throws {
        guard !state.events.contains(where: { $0.id == event.id }) else { return }
        var next = state
        resolveIncident(for: event, in: &next)
        next.events.append(event)
        try commit(next)
    }

    func append(
        _ event: GuardianEvent,
        updatingInactivity inactivity: GuardianInactivityState,
        criticalMessages: [GuardianCriticalMessageOperation] = []
    ) throws {
        var next = state
        if event.type == .noMotionForLongTime {
            guard next.activeInactivityIncidentAt == nil else { return }
            next.activeInactivityIncidentAt = event.timestamp
        }
        resolveIncident(for: event, in: &next)
        next.inactivity = inactivity
        if !next.events.contains(where: { $0.id == event.id }) {
            next.events.append(event)
        }
        let existingIds = Set(next.criticalMessageOperations.map(\.id))
        next.criticalMessageOperations.append(contentsOf: criticalMessages.filter { !existingIds.contains($0.id) })
        if next.criticalMessageOperations.count > 100 {
            next.criticalMessageOperations.removeFirst(next.criticalMessageOperations.count - 100)
        }
        try commit(next)
    }

    func acknowledge(_ ids: Set<String>) throws {
        var next = state
        next.events.removeAll { ids.contains($0.id) }
        try commit(next)
    }

    private func resolveIncident(for event: GuardianEvent, in next: inout State) {
        guard event.type == .motionDetected || event.type == .returnHome,
              let triggeredAt = next.activeInactivityIncidentAt,
              event.timestamp > triggeredAt else { return }
        next.activeInactivityIncidentAt = nil
        for index in next.criticalMessageOperations.indices
            where next.criticalMessageOperations[index].shortcutAttemptPending == true &&
                next.criticalMessageOperations[index].shortcutAttemptedAt == nil {
            next.criticalMessageOperations[index].shortcutAttemptPending = false
            next.criticalMessageOperations[index].shortcutAttemptError = "已检测到活动或回家，取消本次自动发送。"
        }
    }

    private func commit(_ next: State) throws {
        try FileManager.default.createDirectory(at: fileURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .millisecondsSince1970
        let data = try encoder.encode(next)
        try data.write(to: fileURL, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        state = next
    }

    private static func validateThreshold(_ value: Int) throws {
        guard (1...240).contains(value) else { throw GuardianCoreError.invalidConfiguration }
    }
}
