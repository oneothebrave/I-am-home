import Foundation

// Accessed on the main queue together with CLLocationManager and the RN bridge.
final class GuardianEventStore {
    private struct State: Codable {
        var version = 5
        var enabled = false
        var geofences: [GuardianGeofence] = []
        var events: [GuardianEvent] = []
        var noMotionThresholdMinutes = 120
        var activeWindow: GuardianActiveWindow?
        var inactivity = GuardianInactivityState()
        var notificationContacts: [GuardianNotificationContact] = []
        var criticalMessagingAuthorizations: [GuardianCriticalMessageAuthorization] = []
        var criticalMessageOperations: [GuardianCriticalMessageOperation] = []
        var activeInactivityIncidentAt: Date?
        var activeInactivityIncidentEventId: String?
        var movementAnchor: GuardianMovementAnchor?

        private enum CodingKeys: String, CodingKey {
            case version, enabled, geofences, events, noMotionThresholdMinutes, activeWindow, inactivity
            case notificationContacts, criticalMessagingAuthorizations, criticalMessageOperations
            case activeInactivityIncidentAt, activeInactivityIncidentEventId
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
            criticalMessagingAuthorizations = try container.decodeIfPresent(
                [GuardianCriticalMessageAuthorization].self,
                forKey: .criticalMessagingAuthorizations
            ) ?? []
            criticalMessageOperations = try container.decodeIfPresent([GuardianCriticalMessageOperation].self, forKey: .criticalMessageOperations) ?? []
            activeInactivityIncidentAt = try container.decodeIfPresent(Date.self, forKey: .activeInactivityIncidentAt) ?? inactivity.alertEmittedAt
            activeInactivityIncidentEventId = try container.decodeIfPresent(String.self, forKey: .activeInactivityIncidentEventId)
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
    var criticalMessagingAuthorizations: [GuardianCriticalMessageAuthorization] { state.criticalMessagingAuthorizations }
    var criticalMessageOperations: [GuardianCriticalMessageOperation] { state.criticalMessageOperations }
    var activeInactivityIncidentAt: Date? { state.activeInactivityIncidentAt }
    var activeInactivityIncidentEventId: String? { state.activeInactivityIncidentEventId }
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
            guard (1...5).contains(state.version) else { throw GuardianCoreError.unsupportedVersion }
            try GuardianGeofence.validate(state.geofences)
            try GuardianNotificationContact.validate(state.notificationContacts)
            try Self.validateThreshold(state.noMotionThresholdMinutes)
            var needsCommit = false
            if state.version < 5 {
                state.version = 5
                needsCommit = true
            }
            if state.activeInactivityIncidentEventId == nil,
               let incidentAt = state.activeInactivityIncidentAt {
                state.activeInactivityIncidentEventId = state.criticalMessageOperations
                    .first(where: { abs($0.createdAt.timeIntervalSince(incidentAt)) < 1 })?
                    .eventId
                needsCommit = needsCommit || state.activeInactivityIncidentEventId != nil
            }
            for index in state.criticalMessageOperations.indices
                where state.criticalMessageOperations[index].shortcutAttemptPending == true {
                state.criticalMessageOperations[index].shortcutAttemptPending = false
                if state.criticalMessageOperations[index].shortcutAttemptError == nil {
                    state.criticalMessageOperations[index].shortcutAttemptError =
                        "自动运行短信快捷指令已停用；待发送短信仍保存在本机。"
                }
                needsCommit = true
            }
            if Self.reconcileCriticalMessages(in: &state, at: Date()) { needsCommit = true }
            if needsCommit { try commit(state) }
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
        if !enabled {
            cancelUnsentCriticalMessages(
                eventId: next.activeInactivityIncidentEventId,
                reason: "守护已暂停，本次未发送的家人短信已取消。",
                at: Date(),
                in: &next
            )
            next.activeInactivityIncidentAt = nil
            next.activeInactivityIncidentEventId = nil
        }
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
            cancelUnsentCriticalMessages(
                eventId: next.activeInactivityIncidentEventId,
                reason: "已移除家庭地点，本次未发送的家人短信已取消。",
                at: Date(),
                in: &next
            )
            next.inactivity = GuardianInactivityState()
            next.activeInactivityIncidentAt = nil
            next.activeInactivityIncidentEventId = nil
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
            cancelUnsentCriticalMessages(
                eventId: next.activeInactivityIncidentEventId,
                reason: "已离开守护时段，本次未发送的家人短信已取消。",
                at: Date(),
                in: &next
            )
            next.activeInactivityIncidentAt = nil
            next.activeInactivityIncidentEventId = nil
        }
        try commit(next)
    }

    func setNotificationContacts(_ contacts: [GuardianNotificationContact]) throws {
        try GuardianNotificationContact.validate(contacts)
        var next = state
        next.notificationContacts = contacts
        let contactIds = Set(contacts.map(\.id))
        next.criticalMessagingAuthorizations.removeAll { !contactIds.contains($0.contactId) }
        let currentPhones = Dictionary(uniqueKeysWithValues: contacts.map { ($0.id, $0.phoneNumber) })
        let changedAt = Date()
        for index in next.criticalMessageOperations.indices {
            let operation = next.criticalMessageOperations[index]
            guard operation.status != .accepted,
                  ![.failed, .expired, .cancelled].contains(operation.status),
                  currentPhones[operation.contactId] != operation.phoneNumber else { continue }
            next.criticalMessageOperations[index].status = .cancelled
            next.criticalMessageOperations[index].statusUpdatedAt = changedAt
            next.criticalMessageOperations[index].resolvedAt = changedAt
            next.criticalMessageOperations[index].nextAttemptAt = nil
            next.criticalMessageOperations[index].lastErrorCode = "contactChanged"
            next.criticalMessageOperations[index].lastError = "家人联系方式已改变，旧号码的待发送短信已取消。"
        }
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
            next.activeInactivityIncidentEventId = event.id
        }
        resolveIncident(for: event, in: &next)
        next.inactivity = inactivity
        if !next.events.contains(where: { $0.id == event.id }) {
            next.events.append(event)
        }
        let existingIds = Set(next.criticalMessageOperations.map(\.id))
        let newMessages = criticalMessages.filter { !existingIds.contains($0.id) }.map { operation in
            applyingCooldown(to: operation, existing: next.criticalMessageOperations)
        }
        next.criticalMessageOperations.append(contentsOf: newMessages)
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
        cancelUnsentCriticalMessages(
            eventId: next.activeInactivityIncidentEventId,
            reason: event.type == .returnHome
                ? "已确认回到家中，本次未发送的家人短信已取消。"
                : "已重新检测到活动，本次未发送的家人短信已取消。",
            at: event.timestamp,
            in: &next
        )
        next.activeInactivityIncidentAt = nil
        next.activeInactivityIncidentEventId = nil
    }

    @discardableResult
    func reconcileCriticalMessages(at date: Date = Date()) throws -> Bool {
        var next = state
        let changed = Self.reconcileCriticalMessages(in: &next, at: date)
        if changed { try commit(next) }
        return changed
    }

    func setCriticalMessagingUnavailable(code: String, message: String, at date: Date = Date()) throws {
        var next = state
        var changed = false
        for index in next.criticalMessageOperations.indices {
            let operation = next.criticalMessageOperations[index]
            guard isIncidentActive(operation.eventId, in: next),
                  [.prepared, .retryScheduled, .restricted].contains(operation.status),
                  operation.expiresAt > date else { continue }
            if operation.status != .restricted || operation.lastErrorCode != code || operation.lastError != message {
                next.criticalMessageOperations[index].status = .restricted
                next.criticalMessageOperations[index].statusUpdatedAt = date
                next.criticalMessageOperations[index].lastErrorCode = code
                next.criticalMessageOperations[index].lastError = message
                changed = true
            }
        }
        if changed { try commit(next) }
    }

    func updateCriticalMessagingAuthorizations(
        _ rawStatuses: [String: String],
        at date: Date = Date()
    ) throws {
        var next = state
        let records = next.notificationContacts.map { contact -> GuardianCriticalMessageAuthorization in
            let raw = rawStatuses[contact.applePhoneNumber] ?? rawStatuses[contact.phoneNumber] ?? "unknown"
            let status = GuardianCriticalMessageAuthorizationStatus(rawValue: raw) ?? .unknown
            return GuardianCriticalMessageAuthorization(
                contactId: contact.id,
                phoneNumber: contact.phoneNumber,
                status: status,
                checkedAt: date
            )
        }
        next.criticalMessagingAuthorizations = records
        let byContact = Dictionary(uniqueKeysWithValues: records.map { ($0.contactId, $0.status) })
        for index in next.criticalMessageOperations.indices {
            var operation = next.criticalMessageOperations[index]
            guard isIncidentActive(operation.eventId, in: next),
                  ![.accepted, .failed, .expired, .cancelled, .sending].contains(operation.status),
                  operation.expiresAt > date,
                  let authorization = byContact[operation.contactId]
            else { continue }
            operation.authorizationStatus = authorization
            operation.statusUpdatedAt = date
            switch authorization {
            case .approved:
                operation.status = operation.nextAttemptAt.map { $0 > date } == true ? .retryScheduled : .prepared
                operation.lastErrorCode = nil
                operation.lastError = nil
            case .denied:
                operation.status = .restricted
                operation.lastErrorCode = "authorizationDenied"
                operation.lastError = "这位家人尚未允许接收 Apple 关键短信。"
            case .unknown:
                operation.status = .restricted
                operation.lastErrorCode = "authorizationRequired"
                operation.lastError = "需要先在“家人联系方式”中授权 Apple 关键短信。"
            case .unavailable:
                operation.status = .restricted
                operation.lastErrorCode = "authorizationUnavailable"
                operation.lastError = "当前无法读取 Apple 关键短信授权。"
            }
            next.criticalMessageOperations[index] = operation
        }
        try commit(next)
    }

    func readyCriticalMessageOperations(at date: Date = Date()) -> [GuardianCriticalMessageOperation] {
        state.criticalMessageOperations.filter { operation in
            isIncidentActive(operation.eventId, in: state) &&
                operation.authorizationStatus == .approved &&
                [.prepared, .retryScheduled].contains(operation.status) &&
                operation.expiresAt > date &&
                (operation.nextAttemptAt.map { $0 <= date } ?? true)
        }.sorted { left, right in
            if left.createdAt != right.createdAt { return left.createdAt < right.createdAt }
            let leftPriority = state.notificationContacts.first { $0.id == left.contactId }?.priority ?? Int.max
            let rightPriority = state.notificationContacts.first { $0.id == right.contactId }?.priority ?? Int.max
            return leftPriority < rightPriority
        }
    }

    func beginCriticalMessageAttempt(id: String, at date: Date = Date()) throws -> GuardianCriticalMessageOperation? {
        var next = state
        guard let index = next.criticalMessageOperations.firstIndex(where: { $0.id == id }) else { return nil }
        var operation = next.criticalMessageOperations[index]
        guard isIncidentActive(operation.eventId, in: next),
              operation.authorizationStatus == .approved,
              [.prepared, .retryScheduled].contains(operation.status),
              operation.expiresAt > date,
              (operation.nextAttemptAt.map { $0 <= date } ?? true),
              operation.attemptCount < GuardianCriticalMessagingPolicy.maximumAttempts
        else { return nil }
        operation.status = .sending
        operation.statusUpdatedAt = date
        operation.attemptCount += 1
        operation.lastAttemptAt = date
        operation.nextAttemptAt = nil
        operation.lastErrorCode = nil
        operation.lastError = nil
        next.criticalMessageOperations[index] = operation
        try commit(next)
        return operation
    }

    func completeCriticalMessageAttempt(
        id: String,
        accepted: Bool,
        errorCode: String? = nil,
        errorMessage: String? = nil,
        retryable: Bool = false,
        at date: Date = Date()
    ) throws {
        var next = state
        guard let index = next.criticalMessageOperations.firstIndex(where: { $0.id == id }) else { return }
        var operation = next.criticalMessageOperations[index]
        if accepted {
            operation.status = .accepted
            operation.acceptedAt = date
            operation.statusUpdatedAt = date
            operation.nextAttemptAt = nil
            operation.lastErrorCode = nil
            operation.lastError = nil
        } else if operation.status == .cancelled || operation.status == .expired {
            operation.lastErrorCode = errorCode
            operation.lastError = errorMessage
        } else if errorCode.map({ ["notAuthorized", "notSupported", "invalidAuthorization"].contains($0) }) == true {
            operation.status = .restricted
            operation.statusUpdatedAt = date
            operation.nextAttemptAt = nil
            operation.lastErrorCode = errorCode
            operation.lastError = errorMessage
            operation.authorizationStatus = errorCode == "notAuthorized" ? .denied : .unavailable
        } else if retryable,
                  operation.attemptCount < GuardianCriticalMessagingPolicy.maximumAttempts,
                  let retryAt = GuardianCriticalMessagingPolicy.retryDate(
                    after: operation.attemptCount,
                    now: date
                  ),
                  retryAt < operation.expiresAt,
                  isIncidentActive(operation.eventId, in: next) {
            operation.status = .retryScheduled
            operation.statusUpdatedAt = date
            operation.nextAttemptAt = retryAt
            operation.lastErrorCode = errorCode
            operation.lastError = errorMessage
        } else {
            operation.status = .failed
            operation.statusUpdatedAt = date
            operation.nextAttemptAt = nil
            operation.lastErrorCode = errorCode
            operation.lastError = errorMessage
        }
        next.criticalMessageOperations[index] = operation
        try commit(next)
    }

    func nextCriticalMessageActionDate(after date: Date = Date()) -> Date? {
        state.criticalMessageOperations.compactMap { operation -> Date? in
            guard isIncidentActive(operation.eventId, in: state),
                  ![.accepted, .failed, .expired, .cancelled].contains(operation.status),
                  operation.expiresAt > date else { return nil }
            if operation.status == .sending {
                return operation.lastAttemptAt?.addingTimeInterval(GuardianCriticalMessagingPolicy.sendingLease)
            }
            if operation.status == .restricted { return operation.expiresAt }
            return [operation.nextAttemptAt, operation.expiresAt].compactMap { $0 }.min()
        }.min()
    }

    private func applyingCooldown(
        to value: GuardianCriticalMessageOperation,
        existing: [GuardianCriticalMessageOperation]
    ) -> GuardianCriticalMessageOperation {
        var operation = value
        let lastAttempt = existing
            .filter { $0.contactId == value.contactId && $0.eventId != value.eventId }
            .compactMap(\.lastAttemptAt)
            .max()
        guard let cooldownUntil = lastAttempt?.addingTimeInterval(
            GuardianCriticalMessagingPolicy.cooldownInterval
        ), cooldownUntil > value.createdAt else { return operation }
        operation.cooldownUntil = cooldownUntil
        operation.nextAttemptAt = cooldownUntil
        operation.status = .retryScheduled
        operation.lastErrorCode = "cooldown"
        operation.lastError = "为避免短时间内重复通知，将在冷却时间结束后重试。"
        return operation
    }

    private func cancelUnsentCriticalMessages(
        eventId: String?,
        reason: String,
        at date: Date,
        in next: inout State
    ) {
        guard let eventId else { return }
        for index in next.criticalMessageOperations.indices
            where next.criticalMessageOperations[index].eventId == eventId {
            guard next.criticalMessageOperations[index].status != .accepted else {
                next.criticalMessageOperations[index].resolvedAt = date
                continue
            }
            guard ![.failed, .expired, .cancelled].contains(next.criticalMessageOperations[index].status) else { continue }
            next.criticalMessageOperations[index].status = .cancelled
            next.criticalMessageOperations[index].statusUpdatedAt = date
            next.criticalMessageOperations[index].resolvedAt = date
            next.criticalMessageOperations[index].nextAttemptAt = nil
            next.criticalMessageOperations[index].lastErrorCode = "riskResolved"
            next.criticalMessageOperations[index].lastError = reason
        }
    }

    private func isIncidentActive(_ eventId: String, in value: State) -> Bool {
        value.activeInactivityIncidentEventId == eventId
    }

    private static func reconcileCriticalMessages(in value: inout State, at date: Date) -> Bool {
        var changed = false
        for index in value.criticalMessageOperations.indices {
            var operation = value.criticalMessageOperations[index]
            if operation.status == .sending,
               let attemptedAt = operation.lastAttemptAt,
               attemptedAt.addingTimeInterval(GuardianCriticalMessagingPolicy.sendingLease) <= date {
                operation.status = .failed
                operation.statusUpdatedAt = date
                operation.nextAttemptAt = nil
                operation.lastErrorCode = "resultUnknown"
                operation.lastError = "上次发送结果无法确认；为避免重复短信，不会自动重发。"
                changed = true
            } else if ![.accepted, .failed, .expired, .cancelled].contains(operation.status),
                      operation.expiresAt <= date {
                operation.status = .expired
                operation.statusUpdatedAt = date
                operation.nextAttemptAt = nil
                operation.lastErrorCode = "expired"
                operation.lastError = "告警已超过 30 分钟有效期，不再发送。"
                changed = true
            }
            value.criticalMessageOperations[index] = operation
        }
        return changed
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
