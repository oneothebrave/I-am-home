import Foundation

// Accessed on the main queue together with CLLocationManager and the RN bridge.
final class GuardianEventStore {
    private struct State: Codable {
        var version = 2
        var enabled = false
        var geofences: [GuardianGeofence] = []
        var events: [GuardianEvent] = []
        var noMotionThresholdMinutes = 120
        var inactivity = GuardianInactivityState()

        private enum CodingKeys: String, CodingKey {
            case version, enabled, geofences, events, noMotionThresholdMinutes, inactivity
        }

        init() {}

        init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            version = try container.decodeIfPresent(Int.self, forKey: .version) ?? 1
            enabled = try container.decodeIfPresent(Bool.self, forKey: .enabled) ?? false
            geofences = try container.decodeIfPresent([GuardianGeofence].self, forKey: .geofences) ?? []
            events = try container.decodeIfPresent([GuardianEvent].self, forKey: .events) ?? []
            noMotionThresholdMinutes = try container.decodeIfPresent(Int.self, forKey: .noMotionThresholdMinutes) ?? 120
            inactivity = try container.decodeIfPresent(GuardianInactivityState.self, forKey: .inactivity) ?? GuardianInactivityState()
        }
    }
    private let fileURL: URL
    private var state: State
    var enabled: Bool { state.enabled }
    var geofences: [GuardianGeofence] { state.geofences }
    var pendingEvents: [GuardianEvent] { state.events }
    var noMotionThresholdMinutes: Int { state.noMotionThresholdMinutes }
    var inactivity: GuardianInactivityState { state.inactivity }

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
            guard state.version == 1 || state.version == 2 else { throw GuardianCoreError.unsupportedVersion }
            try GuardianGeofence.validate(state.geofences)
            try Self.validateThreshold(state.noMotionThresholdMinutes)
            if state.version == 1 {
                state.version = 2
                try commit(state)
            }
        } else { state = State() }
    }

    func configure(enabled: Bool, geofences: [GuardianGeofence], noMotionThresholdMinutes: Int? = nil) throws {
        try GuardianGeofence.validate(geofences)
        var next = state
        next.enabled = enabled
        next.geofences = geofences
        if let noMotionThresholdMinutes {
            try Self.validateThreshold(noMotionThresholdMinutes)
            next.noMotionThresholdMinutes = noMotionThresholdMinutes
        }
        if !geofences.contains(where: { $0.kind == "home" }) {
            next.inactivity = GuardianInactivityState()
        }
        try commit(next)
    }

    func setNoMotionThresholdMinutes(_ value: Int) throws {
        try Self.validateThreshold(value)
        var next = state
        next.noMotionThresholdMinutes = value
        try commit(next)
    }

    func setInactivity(_ value: GuardianInactivityState) throws {
        var next = state
        next.inactivity = value
        try commit(next)
    }

    func append(_ event: GuardianEvent) throws {
        guard !state.events.contains(where: { $0.id == event.id }) else { return }
        var next = state
        next.events.append(event)
        try commit(next)
    }

    func append(_ event: GuardianEvent, updatingInactivity inactivity: GuardianInactivityState) throws {
        var next = state
        next.inactivity = inactivity
        if !next.events.contains(where: { $0.id == event.id }) {
            next.events.append(event)
        }
        try commit(next)
    }

    func acknowledge(_ ids: Set<String>) throws {
        var next = state
        next.events.removeAll { ids.contains($0.id) }
        try commit(next)
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
        guard (30...240).contains(value) else { throw GuardianCoreError.invalidConfiguration }
    }
}
