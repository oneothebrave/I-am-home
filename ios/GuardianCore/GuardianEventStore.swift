import Foundation

// Accessed on the main queue together with CLLocationManager and the RN bridge.
final class GuardianEventStore {
    private struct State: Codable {
        var version = 1
        var enabled = false
        var geofences: [GuardianGeofence] = []
        var events: [GuardianEvent] = []
    }
    private let fileURL: URL
    private var state: State
    var enabled: Bool { state.enabled }
    var geofences: [GuardianGeofence] { state.geofences }
    var pendingEvents: [GuardianEvent] { state.events }

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
            guard state.version == 1 else { throw GuardianCoreError.unsupportedVersion }
            try GuardianGeofence.validate(state.geofences)
        } else { state = State() }
    }

    func configure(enabled: Bool, geofences: [GuardianGeofence]) throws {
        try GuardianGeofence.validate(geofences)
        var next = state
        next.enabled = enabled
        next.geofences = geofences
        try commit(next)
    }

    func append(_ event: GuardianEvent) throws {
        guard !state.events.contains(where: { $0.id == event.id }) else { return }
        var next = state
        next.events.append(event)
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
}
