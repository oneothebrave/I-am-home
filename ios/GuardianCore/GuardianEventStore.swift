import Foundation

// Accessed on the main queue together with CLLocationManager and the RN bridge.
final class GuardianEventStore {
    private struct State: Codable {
        var version = 6
        var enabled = false
        var userPaused = false
        var dataDeletionPending = false
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
        var monitoringPolicy = GuardianMonitoringPolicy()
        var riskState = GuardianRiskState()
        var activeRiskEventIds: [String: String] = [:]

        private enum CodingKeys: String, CodingKey {
            case dataDeletionPending, userPaused
            case version, enabled, geofences, events, noMotionThresholdMinutes, activeWindow, inactivity
            case notificationContacts, criticalMessagingAuthorizations, criticalMessageOperations
            case activeInactivityIncidentAt, activeInactivityIncidentEventId
            case movementAnchor
            case monitoringPolicy, riskState, activeRiskEventIds
        }

        init() {}

        init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            version = try container.decodeIfPresent(Int.self, forKey: .version) ?? 1
            enabled = try container.decodeIfPresent(Bool.self, forKey: .enabled) ?? false
            userPaused = try container.decodeIfPresent(Bool.self, forKey: .userPaused) ?? false
            if userPaused { enabled = false }
            dataDeletionPending = try container.decodeIfPresent(Bool.self, forKey: .dataDeletionPending) ?? false
            if dataDeletionPending { enabled = false }
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
            if version >= 6 {
                monitoringPolicy = try container.decode(GuardianMonitoringPolicy.self, forKey: .monitoringPolicy)
                riskState = try container.decode(GuardianRiskState.self, forKey: .riskState)
                activeRiskEventIds = try container.decode([String: String].self, forKey: .activeRiskEventIds)
            } else {
                monitoringPolicy = GuardianMonitoringPolicy(noMotionThresholdMinutes: noMotionThresholdMinutes)
            }
        }
    }
    private let fileURL: URL
    private var state: State
    var enabled: Bool { state.enabled }
    var userPaused: Bool { state.userPaused }
    var dataDeletionPending: Bool { state.dataDeletionPending }
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
    var monitoringPolicy: GuardianMonitoringPolicy { state.monitoringPolicy }
    var riskState: GuardianRiskState { state.riskState }

    func setMovementAnchor(_ value: GuardianMovementAnchor?) throws {
        var next = state
        next.movementAnchor = value
        try commit(next)
    }

    init(fileURL: URL? = nil, resettingForDeletion: Bool = false) throws {
        if let fileURL { self.fileURL = fileURL }
        else {
            let directory = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
                .appendingPathComponent("GuardianCore", isDirectory: true)
            self.fileURL = directory.appendingPathComponent("state-v1.json")
        }
        // Only an explicitly confirmed delete may bypass corrupt/unknown data.
        // Ordinary startup still fails closed and never replaces the user's file.
        if resettingForDeletion {
            state = State()
            state.dataDeletionPending = true
            try commit(state)
        } else if FileManager.default.fileExists(atPath: self.fileURL.path) {
            // Upgrade existing files even if no business-data migration/write is needed.
            try GuardianStorageProtection.prepareDirectory(self.fileURL.deletingLastPathComponent())
            try GuardianStorageProtection.protectFile(self.fileURL)
            let decoder = JSONDecoder()
            decoder.dateDecodingStrategy = .millisecondsSince1970
            state = try decoder.decode(State.self, from: Data(contentsOf: self.fileURL))
            guard (1...6).contains(state.version) else { throw GuardianCoreError.unsupportedVersion }
            try GuardianGeofence.validate(state.geofences)
            try GuardianNotificationContact.validate(state.notificationContacts)
            try Self.validateThreshold(state.noMotionThresholdMinutes)
            try state.monitoringPolicy.validate()
            guard state.monitoringPolicy.noMotionThresholdMinutes == state.noMotionThresholdMinutes
            else { throw GuardianCoreError.invalidConfiguration }
            var needsCommit = false
            if state.version < 6 {
                state.version = 6
                // Legacy builds did not distinguish test runs. Never promote their queued alerts.
                var migrated = state
                resetRiskSession(in: &migrated, reason: "升级后已进入测试模式，请检查设置后选择正式模式。", at: Date())
                state = migrated
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
        notificationContacts: [GuardianNotificationContact]? = nil,
        monitoringPolicy: GuardianMonitoringPolicy? = nil,
        userPaused: Bool? = nil
    ) throws {
        guard !state.dataDeletionPending else { throw GuardianCoreError.invalidConfiguration }
        try GuardianGeofence.validate(geofences)
        var next = state
        let wasEnabled = next.enabled
        if let userPaused { next.userPaused = userPaused }
        guard !enabled || !next.userPaused else { throw GuardianCoreError.invalidConfiguration }
        next.enabled = enabled
        if !enabled && wasEnabled {
            resetRiskSession(in: &next, reason: "守护已暂停，本轮风险检查已结束。", at: Date())
        }
        if let monitoringPolicy {
            try monitoringPolicy.validate()
            if monitoringPolicy != next.monitoringPolicy {
                resetRiskSession(in: &next, reason: "守护规则已改变，重新开始风险检查。", at: Date())
            }
            next.monitoringPolicy = monitoringPolicy
            next.noMotionThresholdMinutes = monitoringPolicy.noMotionThresholdMinutes
        }
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
            next.monitoringPolicy.noMotionThresholdMinutes = noMotionThresholdMinutes
            try next.monitoringPolicy.validate()
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
        var policy = state.monitoringPolicy
        policy.noMotionThresholdMinutes = value
        try setMonitoringPolicy(policy, activeWindow: state.activeWindow)
    }

    func setMonitoringPolicy(_ policy: GuardianMonitoringPolicy, activeWindow: GuardianActiveWindow?) throws {
        guard !state.dataDeletionPending else { throw GuardianCoreError.invalidConfiguration }
        try policy.validate()
        guard policy != state.monitoringPolicy || activeWindow != state.activeWindow else { return }
        var next = state
        resetRiskSession(in: &next, reason: "守护规则已改变，旧告警已结束并重新计时。", at: Date())
        next.monitoringPolicy = policy
        next.noMotionThresholdMinutes = policy.noMotionThresholdMinutes
        next.activeWindow = activeWindow
        try commit(next)
    }

    @discardableResult
    func reconcileClock(at date: Date) throws -> Bool {
        var next = state
        var changed = next.inactivity.reconcileClock(at: date)
        if next.movementAnchor.map({ $0.timestamp > date.addingTimeInterval(5) }) == true {
            next.movementAnchor = nil
            changed = true
        }
        if next.activeInactivityIncidentAt.map({ $0 > date.addingTimeInterval(5) }) == true {
            next.activeInactivityIncidentAt = date
            changed = true
        }
        if changed { try commit(next) }
        return changed
    }

    private func resetRiskSession(in next: inout State, reason: String, at date: Date) {
        let ids = Set(next.criticalMessageOperations.map(\.eventId))
        for id in ids { cancelUnsentCriticalMessages(eventId: id, reason: reason, at: date, in: &next) }
        next.activeRiskEventIds = [:]
        next.riskState = GuardianRiskState()
        next.activeInactivityIncidentAt = nil
        next.activeInactivityIncidentEventId = nil
        next.inactivity.suspendAwayTracking()
        next.events.append(GuardianEvent(type: .guardianSessionReset, title: "本轮守护检查已结束",
            description: reason, timestamp: date, source: "user",
            isTest: next.monitoringPolicy.mode == .test))
    }

    // Detector state, recovery, event queue and all recipient operations commit together.
    func evaluateRisks(_ check: GuardianRiskCheck, detectionContext: String) throws -> [GuardianEvent] {
        guard !state.dataDeletionPending else { return [] }
        var next = state
        let transitions = next.riskState.evaluate(check, policy: next.monitoringPolicy)
        var emitted: [GuardianEvent] = []
        for transition in transitions {
            let type: GuardianEventType
            let title: String
            let detail: String
            let reason: String?
            let activeKey: String
            let isRisk: Bool
            switch transition {
            case .lowBattery:
                type = .lowBattery; title = "家外手机电量偏低"
                detail = "手机在家外，电量低于 20% 且未充电，建议家人留意。"
                reason = nil; activeKey = GuardianEventType.lowBattery.rawValue; isRisk = true
            case .batteryRecovered:
                type = .batteryRecovered; title = "低电量提醒已解除"
                detail = "手机已连接充电、电量恢复或结束家外守护。"
                reason = nil; activeKey = GuardianEventType.lowBattery.rawValue; isRisk = false
            case .locationLost(let cause):
                type = .locationLost; title = "位置守护需要留意"
                detail = cause.explanation
                reason = cause.rawValue; activeKey = GuardianEventType.locationLost.rawValue; isRisk = true
            case .locationRestored:
                type = .locationRestored; title = "位置异常提醒已解除"
                detail = check.expectsLocation
                    ? "已恢复可信位置及必要权限。"
                    : "当前已结束家外位置检查；不表示已取得新的位置。"
                reason = nil; activeKey = GuardianEventType.locationLost.rawValue; isRisk = false
            case .locationPeriodReset:
                type = .locationRestored; title = "旧时段的位置提醒已结束"
                detail = "已进入新的守护时段，重新等待可信位置；不表示已经恢复定位。"
                reason = nil; activeKey = GuardianEventType.locationLost.rawValue; isRisk = false
            }
            let event = GuardianEvent(type: type, title: title, description: detail,
                timestamp: check.date, source: activeKey == "LOW_BATTERY" ? "battery" : "location",
                batteryLevel: check.batteryLevel.flatMap { (0...100).contains($0) ? Float($0) / 100 : nil },
                isTest: next.monitoringPolicy.mode == .test, riskReason: reason)
            if isRisk {
                next.activeRiskEventIds[activeKey] = event.id
                var operations = GuardianCriticalMessageOperation.prepare(for: event,
                    contacts: next.notificationContacts,
                    thresholdMinutes: next.monitoringPolicy.locationLostThresholdMinutes)
                for index in operations.indices { operations[index].detectionContext = detectionContext }
                let prepared = operations.map {
                    applyingCooldown(to: $0, existing: next.criticalMessageOperations)
                }
                next.criticalMessageOperations.append(contentsOf: prepared)
            } else {
                cancelUnsentCriticalMessages(eventId: next.activeRiskEventIds[activeKey],
                    reason: detail, at: check.date, in: &next)
                next.activeRiskEventIds.removeValue(forKey: activeKey)
            }
            next.events.append(event)
            emitted.append(event)
        }
        if next.riskState != state.riskState || !emitted.isEmpty { try commit(next) }
        return emitted
    }

    @discardableResult
    func setActiveWindow(_ value: GuardianActiveWindow) throws -> Bool {
        guard !state.dataDeletionPending else { throw GuardianCoreError.invalidConfiguration }
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
        guard !state.dataDeletionPending else { throw GuardianCoreError.invalidConfiguration }
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
        try commit(next)
    }

    func acknowledge(_ ids: Set<String>) throws {
        var next = state
        next.events.removeAll { ids.contains($0.id) }
        try commit(next)
    }

    // The JS journal remains pending until this replacement and runtime shutdown
    // succeed. An I/O failure must never be reported as successful deletion.
    func clearLocalData() throws {
        var cleared = State()
        cleared.userPaused = true
        try commit(cleared)
    }

    func beginDataDeletion() throws {
        var next = state
        next.dataDeletionPending = true
        next.userPaused = true
        next.enabled = false
        resetRiskSession(in: &next, reason: "正在清除本机数据，守护已停止。", at: Date())
        try commit(next)
    }

    func pruneHistory(at date: Date = Date()) throws {
        var next = state
        Self.pruneCompletedMessages(in: &next, at: date)
        try commit(next)
    }

    private static func pruneCompletedMessages(in value: inout State, at date: Date) {
        let activeIds = Set(value.activeRiskEventIds.values)
            .union(value.activeInactivityIncidentEventId.map { [$0] } ?? [])
        let cutoff = date.addingTimeInterval(-30 * 24 * 60 * 60)
        let terminal: Set<GuardianCriticalMessageStatus> = [.accepted, .failed, .expired, .cancelled]
        let completed = value.criticalMessageOperations.filter {
            terminal.contains($0.status) && !activeIds.contains($0.eventId) && $0.statusUpdatedAt >= cutoff
        }.sorted { $0.statusUpdatedAt < $1.statusUpdatedAt }
        let retainedIds = Set(completed.suffix(100).map(\.id))
        value.criticalMessageOperations.removeAll {
            terminal.contains($0.status) && !activeIds.contains($0.eventId) && !retainedIds.contains($0.id)
        }
        // Unacknowledged events are a delivery queue, not disposable history.
        // Only durable JS acknowledgement or explicit clear removes them.
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
            guard operation.isTest != true, isIncidentActive(operation.eventId, in: next),
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
        guard state.monitoringPolicy.mode == .standard else { return [] }
        return state.criticalMessageOperations.filter { operation in
            operation.isTest != true &&
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
        guard next.monitoringPolicy.mode == .standard, operation.isTest != true,
              isIncidentActive(operation.eventId, in: next),
              operation.authorizationStatus == .approved,
              [.prepared, .retryScheduled].contains(operation.status),
              operation.expiresAt > date,
              (operation.nextAttemptAt.map { $0 <= date } ?? true),
              operation.attemptCount < GuardianCriticalMessagingPolicy.maximumAttempts
        else { return nil }
        // Other risks may have started sending since this operation was queued.
        operation = applyingCooldown(to: operation, existing: next.criticalMessageOperations, at: date)
        if operation.cooldownUntil.map({ $0 > date }) == true {
            operation.statusUpdatedAt = date
            next.criticalMessageOperations[index] = operation
            try commit(next)
            return nil
        }
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
        // A late error (including a post-write protection failure) cannot undo acceptance.
        guard operation.status != .accepted else { return }
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
        existing: [GuardianCriticalMessageOperation],
        at date: Date? = nil
    ) -> GuardianCriticalMessageOperation {
        var operation = value
        guard operation.isTest != true else { return operation }
        let lastAttempt = existing
            .filter { $0.isTest != true && $0.contactId == value.contactId && $0.eventId != value.eventId }
            .compactMap(\.lastAttemptAt)
            .max()
        guard let cooldownUntil = lastAttempt?.addingTimeInterval(
            GuardianCriticalMessagingPolicy.cooldownInterval
        ), cooldownUntil > (date ?? value.createdAt) else { return operation }
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
        value.activeInactivityIncidentEventId == eventId || value.activeRiskEventIds.values.contains(eventId)
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
        var next = next
        Self.pruneCompletedMessages(in: &next, at: Date())
        try GuardianStorageProtection.prepareDirectory(fileURL.deletingLastPathComponent())
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .millisecondsSince1970
        let data = try encoder.encode(next)
        try data.write(to: fileURL, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        state = next
        // The atomic replacement already committed. Keep memory aligned with disk
        // even if the subsequent metadata verification fails and the caller retries.
        try GuardianStorageProtection.protectFile(fileURL)
    }

    private static func validateThreshold(_ value: Int) throws {
        guard (1...240).contains(value) else { throw GuardianCoreError.invalidConfiguration }
    }
}
