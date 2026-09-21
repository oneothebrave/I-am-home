import Foundation
import Messages
import UIKit

struct GuardianNotificationContact: Codable, Equatable {
    let id: String
    let name: String
    let phoneNumber: String
    let priority: Int

    init(dictionary: [String: Any]) throws {
        guard let id = dictionary["id"] as? String, !id.isEmpty,
              let name = dictionary["name"] as? String,
              !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              let rawPhone = dictionary["phone"] as? String,
              let priority = dictionary["priority"] as? NSNumber,
              (1...3).contains(priority.intValue)
        else { throw GuardianCoreError.invalidConfiguration }
        let phone = Self.normalizedPhone(rawPhone)
        guard Self.isValidPhone(phone) else { throw GuardianCoreError.invalidConfiguration }
        self.id = id
        self.name = name.trimmingCharacters(in: .whitespacesAndNewlines)
        self.phoneNumber = phone
        self.priority = priority.intValue
    }

    static func validate(_ contacts: [GuardianNotificationContact]) throws {
        guard contacts.count <= 3,
              Set(contacts.map(\.id)).count == contacts.count,
              Set(contacts.map(\.phoneNumber)).count == contacts.count,
              Set(contacts.map(\.priority)).count == contacts.count
        else { throw GuardianCoreError.invalidConfiguration }
    }

    func toDictionary() -> [String: Any] {
        ["id": id, "name": name, "phoneNumber": phoneNumber, "priority": priority]
    }

    var applePhoneNumber: String { phoneNumber.filter(\.isNumber) }

    private static func normalizedPhone(_ value: String) -> String {
        value.filter { $0 == "+" || $0.isNumber }
    }

    private static func isValidPhone(_ value: String) -> Bool {
        let digits = value.filter(\.isNumber)
        return (7...15).contains(digits.count) && value.dropFirst().allSatisfy(\.isNumber)
    }
}

enum GuardianCriticalMessageStatus: String, Codable {
    case prepared
    case sending
    case retryScheduled
    case accepted
    case failed
    case restricted
    case expired
    case cancelled

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        let rawValue = try container.decode(String.self)
        // v4 used "sent" before the UI distinguished system acceptance from delivery.
        if rawValue == "sent" { self = .accepted }
        else if let value = Self(rawValue: rawValue) { self = value }
        else { throw DecodingError.dataCorruptedError(in: container, debugDescription: "Unknown Critical Messaging status") }
    }
}

enum GuardianCriticalMessageAuthorizationStatus: String, Codable {
    case unknown
    case approved
    case denied
    case unavailable
}

struct GuardianCriticalMessageAuthorization: Codable, Equatable {
    let contactId: String
    let phoneNumber: String
    var status: GuardianCriticalMessageAuthorizationStatus
    var checkedAt: Date

    func toDictionary() -> [String: Any] {
        [
            "contactId": contactId,
            "phoneNumber": phoneNumber,
            "status": status.rawValue,
            "checkedAt": GuardianCriticalMessageOperation.dateString(checkedAt)
        ]
    }
}

enum GuardianCriticalMessagingPolicy {
    static let validityInterval: TimeInterval = 30 * 60
    static let retryDelays: [TimeInterval] = [60, 5 * 60]
    static let cooldownInterval: TimeInterval = 10 * 60
    static let sendingLease: TimeInterval = 2 * 60
    static let maximumAttempts = 1 + retryDelays.count

    static var dictionary: [String: Any] {
        [
            "validityMinutes": Int(validityInterval / 60),
            "maximumAttempts": maximumAttempts,
            "retryDelaysSeconds": retryDelays.map(Int.init),
            "cooldownMinutes": Int(cooldownInterval / 60)
        ]
    }

    static func retryDate(after attemptCount: Int, now: Date) -> Date? {
        let delayIndex = attemptCount - 1
        guard retryDelays.indices.contains(delayIndex) else { return nil }
        return now.addingTimeInterval(retryDelays[delayIndex])
    }
}

struct GuardianCriticalMessageOperation: Codable, Equatable {
    let id: String
    let eventId: String
    let contactId: String
    let contactName: String
    let phoneNumber: String
    let messageText: String
    let createdAt: Date
    var status: GuardianCriticalMessageStatus
    var statusUpdatedAt: Date
    var authorizationStatus: GuardianCriticalMessageAuthorizationStatus
    var attemptCount: Int
    var lastAttemptAt: Date?
    var nextAttemptAt: Date?
    var expiresAt: Date
    var cooldownUntil: Date?
    var acceptedAt: Date?
    var resolvedAt: Date?
    var lastErrorCode: String?
    var lastError: String?
    // Legacy Shortcut fields remain readable so an upgrade never corrupts v4 data.
    var shortcutAttemptPending: Bool?
    var shortcutAttemptedAt: Date?
    var shortcutOpenSucceeded: Bool?
    var shortcutAttemptError: String?
    var detectionContext: String?

    private enum CodingKeys: String, CodingKey {
        case id, eventId, contactId, contactName, phoneNumber, messageText, createdAt, status
        case statusUpdatedAt, authorizationStatus, attemptCount, lastAttemptAt, nextAttemptAt
        case expiresAt, cooldownUntil, acceptedAt, sentAt, resolvedAt, lastErrorCode, lastError
        case shortcutAttemptPending, shortcutAttemptedAt, shortcutOpenSucceeded
        case shortcutAttemptError, detectionContext
    }

    init(
        id: String,
        eventId: String,
        contactId: String,
        contactName: String,
        phoneNumber: String,
        messageText: String,
        createdAt: Date,
        status: GuardianCriticalMessageStatus = .prepared,
        shortcutAttemptPending: Bool? = false
    ) {
        self.id = id
        self.eventId = eventId
        self.contactId = contactId
        self.contactName = contactName
        self.phoneNumber = phoneNumber
        self.messageText = messageText
        self.createdAt = createdAt
        self.status = status
        statusUpdatedAt = createdAt
        authorizationStatus = .unknown
        attemptCount = 0
        nextAttemptAt = createdAt
        expiresAt = createdAt.addingTimeInterval(GuardianCriticalMessagingPolicy.validityInterval)
        self.shortcutAttemptPending = shortcutAttemptPending
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        eventId = try container.decode(String.self, forKey: .eventId)
        contactId = try container.decode(String.self, forKey: .contactId)
        contactName = try container.decode(String.self, forKey: .contactName)
        phoneNumber = try container.decode(String.self, forKey: .phoneNumber)
        messageText = try container.decode(String.self, forKey: .messageText)
        createdAt = try container.decode(Date.self, forKey: .createdAt)
        status = try container.decodeIfPresent(GuardianCriticalMessageStatus.self, forKey: .status) ?? .prepared
        statusUpdatedAt = try container.decodeIfPresent(Date.self, forKey: .statusUpdatedAt) ?? createdAt
        authorizationStatus = try container.decodeIfPresent(
            GuardianCriticalMessageAuthorizationStatus.self,
            forKey: .authorizationStatus
        ) ?? .unknown
        attemptCount = try container.decodeIfPresent(Int.self, forKey: .attemptCount) ?? 0
        lastAttemptAt = try container.decodeIfPresent(Date.self, forKey: .lastAttemptAt)
        nextAttemptAt = try container.decodeIfPresent(Date.self, forKey: .nextAttemptAt)
        expiresAt = try container.decodeIfPresent(Date.self, forKey: .expiresAt)
            ?? createdAt.addingTimeInterval(GuardianCriticalMessagingPolicy.validityInterval)
        cooldownUntil = try container.decodeIfPresent(Date.self, forKey: .cooldownUntil)
        acceptedAt = try container.decodeIfPresent(Date.self, forKey: .acceptedAt)
            ?? container.decodeIfPresent(Date.self, forKey: .sentAt)
        resolvedAt = try container.decodeIfPresent(Date.self, forKey: .resolvedAt)
        lastErrorCode = try container.decodeIfPresent(String.self, forKey: .lastErrorCode)
        lastError = try container.decodeIfPresent(String.self, forKey: .lastError)
        shortcutAttemptPending = try container.decodeIfPresent(Bool.self, forKey: .shortcutAttemptPending)
        shortcutAttemptedAt = try container.decodeIfPresent(Date.self, forKey: .shortcutAttemptedAt)
        shortcutOpenSucceeded = try container.decodeIfPresent(Bool.self, forKey: .shortcutOpenSucceeded)
        shortcutAttemptError = try container.decodeIfPresent(String.self, forKey: .shortcutAttemptError)
        detectionContext = try container.decodeIfPresent(String.self, forKey: .detectionContext)
        if nextAttemptAt == nil && status == .prepared { nextAttemptAt = createdAt }
        if acceptedAt != nil { status = .accepted }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(eventId, forKey: .eventId)
        try container.encode(contactId, forKey: .contactId)
        try container.encode(contactName, forKey: .contactName)
        try container.encode(phoneNumber, forKey: .phoneNumber)
        try container.encode(messageText, forKey: .messageText)
        try container.encode(createdAt, forKey: .createdAt)
        try container.encode(status, forKey: .status)
        try container.encode(statusUpdatedAt, forKey: .statusUpdatedAt)
        try container.encode(authorizationStatus, forKey: .authorizationStatus)
        try container.encode(attemptCount, forKey: .attemptCount)
        try container.encodeIfPresent(lastAttemptAt, forKey: .lastAttemptAt)
        try container.encodeIfPresent(nextAttemptAt, forKey: .nextAttemptAt)
        try container.encode(expiresAt, forKey: .expiresAt)
        try container.encodeIfPresent(cooldownUntil, forKey: .cooldownUntil)
        try container.encodeIfPresent(acceptedAt, forKey: .acceptedAt)
        try container.encodeIfPresent(resolvedAt, forKey: .resolvedAt)
        try container.encodeIfPresent(lastErrorCode, forKey: .lastErrorCode)
        try container.encodeIfPresent(lastError, forKey: .lastError)
        try container.encodeIfPresent(shortcutAttemptPending, forKey: .shortcutAttemptPending)
        try container.encodeIfPresent(shortcutAttemptedAt, forKey: .shortcutAttemptedAt)
        try container.encodeIfPresent(shortcutOpenSucceeded, forKey: .shortcutOpenSucceeded)
        try container.encodeIfPresent(shortcutAttemptError, forKey: .shortcutAttemptError)
        try container.encodeIfPresent(detectionContext, forKey: .detectionContext)
    }

    static func prepare(
        for event: GuardianEvent,
        contacts: [GuardianNotificationContact],
        thresholdMinutes: Int
    ) -> [GuardianCriticalMessageOperation] {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "zh_CN")
        formatter.dateFormat = "M月d日 HH:mm"
        var details = [
            "时间：\(formatter.string(from: event.timestamp))",
            "位置：\(locationDescription(for: event))"
        ]
        if let battery = event.batteryLevel { details.append("电量：\(battery)%") }
        let message = "【到家了么】检测到被守护人的手机在家外已连续约\(thresholdMinutes)分钟没有明显活动。\(details.joined(separator: "，"))。请尽快联系确认。"
        return contacts.sorted(by: { $0.priority < $1.priority }).map { contact in
            GuardianCriticalMessageOperation(
                id: "\(event.id):\(contact.id)",
                eventId: event.id,
                contactId: contact.id,
                contactName: contact.name,
                phoneNumber: contact.phoneNumber,
                messageText: message,
                createdAt: event.timestamp
            )
        }
    }

    private static func locationDescription(for event: GuardianEvent) -> String {
        let genericLabels = Set(["家外", "守护地点外", "位置未知"])
        let namedPlace = event.locationLabel.flatMap {
            genericLabels.contains($0) ? nil : $0
        }
        guard let location = event.location else {
            return namedPlace ?? "守护地点外（具体位置暂无法确认）"
        }
        let coordinate = String(
            format: "纬度 %.5f，经度 %.5f",
            locale: Locale(identifier: "en_US_POSIX"),
            location.latitude,
            location.longitude
        )
        let accuracy = location.accuracy.map { "，精度约 \(Int($0.rounded())) 米" } ?? ""
        if let namedPlace { return "\(namedPlace)（\(coordinate)\(accuracy)）" }
        return "\(coordinate)\(accuracy)"
    }

    static func dateString(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: date)
    }

    func toDictionary() -> [String: Any] {
        var payload: [String: Any] = [
            "id": id,
            "eventId": eventId,
            "contactId": contactId,
            "contactName": contactName,
            "phoneNumber": phoneNumber,
            "messageText": messageText,
            "createdAt": Self.dateString(createdAt),
            "status": status.rawValue,
            "statusUpdatedAt": Self.dateString(statusUpdatedAt),
            "authorizationStatus": authorizationStatus.rawValue,
            "attemptCount": attemptCount,
            "expiresAt": Self.dateString(expiresAt),
            "shortcutAttemptPending": shortcutAttemptPending == true
        ]
        if let lastAttemptAt { payload["lastAttemptAt"] = Self.dateString(lastAttemptAt) }
        if let nextAttemptAt { payload["nextAttemptAt"] = Self.dateString(nextAttemptAt) }
        if let cooldownUntil { payload["cooldownUntil"] = Self.dateString(cooldownUntil) }
        if let acceptedAt {
            payload["acceptedAt"] = Self.dateString(acceptedAt)
            payload["sentAt"] = Self.dateString(acceptedAt)
        }
        if let resolvedAt { payload["resolvedAt"] = Self.dateString(resolvedAt) }
        if let lastErrorCode { payload["lastErrorCode"] = lastErrorCode }
        if let lastError { payload["lastError"] = lastError }
        if let shortcutAttemptedAt { payload["shortcutAttemptedAt"] = Self.dateString(shortcutAttemptedAt) }
        if let shortcutOpenSucceeded { payload["shortcutOpenSucceeded"] = shortcutOpenSucceeded }
        if let shortcutAttemptError { payload["shortcutAttemptError"] = shortcutAttemptError }
        if let detectionContext { payload["detectionContext"] = detectionContext }
        return payload
    }
}

enum GuardianCriticalMessagingCapability {
    static var apiAvailable: Bool {
        if #available(iOS 18.2, *) { return true }
        return false
    }

    // Keep this false until the App ID, provisioning profile, and target all include
    // com.apple.developer.messages.critical-messaging.
    static var enabledForBuild: Bool {
        Bundle.main.object(forInfoDictionaryKey: "GuardianCriticalMessagingEnabled") as? Bool == true
    }
}

@available(iOS 18.2, *)
final class GuardianCriticalMessagingGateway {
    private let messenger = MSCriticalSMSMessenger()

    func requestAuthorization(for contacts: [GuardianNotificationContact]) async throws -> [String: String] {
        let recipients = contacts.map { MSRecipient(phoneNumber: $0.applePhoneNumber) }
        let result = try await messenger.requestAuthorization(for: recipients)
        return Dictionary(uniqueKeysWithValues: result.map { recipient, status in
            (recipient.phoneNumber, Self.authorizationLabel(status))
        })
    }

    func checkAuthorization(for contacts: [GuardianNotificationContact]) async throws -> [String: String] {
        let recipients = contacts.map { MSRecipient(phoneNumber: $0.applePhoneNumber) }
        let result = try await messenger.checkAuthorizationStatus(for: recipients)
        return Dictionary(uniqueKeysWithValues: result.map { recipient, status in
            (recipient.phoneNumber, Self.authorizationLabel(status))
        })
    }

    func send(_ operation: GuardianCriticalMessageOperation) async throws -> Bool {
        try await messenger.send(
            MSCriticalMessage(messageText: operation.messageText),
            to: MSRecipient(phoneNumber: operation.phoneNumber.filter(\.isNumber))
        )
    }

    private static func authorizationLabel(_ status: MSCriticalMessagingAuthorizationStatus) -> String {
        switch status {
        case .unknown: return "unknown"
        case .denied: return "denied"
        case .approved: return "approved"
        @unknown default: return "unknown"
        }
    }
}

final class GuardianCriticalMessagingCoordinator {
    private let store: GuardianEventStore
    private var processingTask: Task<Void, Never>?
    var onUpdate: (() -> Void)?
    var onNextActionDate: ((Date?) -> Void)?

    init(store: GuardianEventStore) {
        self.store = store
    }

    func process(reason: String) async {
        if let processingTask {
            await processingTask.value
            return
        }
        let task = Task { @MainActor [weak self] in
            guard let self else { return }
            await self.runProcess(reason: reason)
        }
        processingTask = task
        await task.value
        processingTask = nil
    }

    func requestAuthorization() async throws {
        guard GuardianCriticalMessagingCapability.apiAvailable else {
            throw GuardianCoreError.criticalMessagingUnavailable("当前 iOS 版本不支持 Apple 关键短信。")
        }
        guard GuardianCriticalMessagingCapability.enabledForBuild else {
            throw GuardianCoreError.criticalMessagingUnavailable("工程尚未启用 Apple 关键短信能力。")
        }
        let contacts = store.notificationContacts
        guard !contacts.isEmpty else {
            throw GuardianCoreError.criticalMessagingUnavailable("请先添加至少一位家人。")
        }
        guard #available(iOS 18.2, *) else { return }
        let result = try await GuardianCriticalMessagingGateway().requestAuthorization(for: contacts)
        try store.updateCriticalMessagingAuthorizations(result)
        onUpdate?()
        await process(reason: "authorization-request")
    }

    func refreshAuthorization() async throws {
        guard GuardianCriticalMessagingCapability.apiAvailable,
              GuardianCriticalMessagingCapability.enabledForBuild,
              !store.notificationContacts.isEmpty,
              #available(iOS 18.2, *) else { return }
        let result = try await GuardianCriticalMessagingGateway().checkAuthorization(
            for: store.notificationContacts
        )
        try store.updateCriticalMessagingAuthorizations(result)
        onUpdate?()
    }

    var readiness: String {
        guard !store.notificationContacts.isEmpty else { return "noRecipients" }
        guard GuardianCriticalMessagingCapability.apiAvailable else { return "apiUnavailable" }
        guard GuardianCriticalMessagingCapability.enabledForBuild else { return "buildNotConfigured" }
        let byContact = Dictionary(uniqueKeysWithValues: store.criticalMessagingAuthorizations.map {
            ($0.contactId, $0.status)
        })
        let statuses = store.notificationContacts.map { byContact[$0.id] ?? .unknown }
        if statuses.contains(.denied) { return "authorizationDenied" }
        if statuses.allSatisfy({ $0 == .approved }) { return "ready" }
        return "authorizationRequired"
    }

    @MainActor
    private func runProcess(reason: String) async {
        do {
            _ = try store.reconcileCriticalMessages()
            guard !store.criticalMessageOperations.isEmpty else {
                publishSchedule()
                return
            }
            guard GuardianCriticalMessagingCapability.apiAvailable else {
                try store.setCriticalMessagingUnavailable(
                    code: "apiUnavailable",
                    message: "当前 iOS 版本不支持 Apple 关键短信。"
                )
                publishSchedule()
                return
            }
            guard GuardianCriticalMessagingCapability.enabledForBuild else {
                try store.setCriticalMessagingUnavailable(
                    code: "buildNotConfigured",
                    message: "工程尚未启用 Apple 关键短信；告警内容已保存在本机。"
                )
                publishSchedule()
                return
            }
            guard #available(iOS 18.2, *) else { return }
            let gateway = GuardianCriticalMessagingGateway()
            let authorization = try await gateway.checkAuthorization(for: store.notificationContacts)
            try store.updateCriticalMessagingAuthorizations(authorization)

            // Apple only supports send(_:to:) while the app is backgrounded.
            guard UIApplication.shared.applicationState == .background else {
                publishSchedule()
                return
            }

            for candidate in store.readyCriticalMessageOperations() {
                guard let operation = try store.beginCriticalMessageAttempt(id: candidate.id) else { continue }
                do {
                    let accepted = try await gateway.send(operation)
                    try store.completeCriticalMessageAttempt(
                        id: operation.id,
                        accepted: accepted,
                        errorCode: accepted ? nil : "sendRejected",
                        errorMessage: accepted ? nil : "系统没有接受这次关键短信发送请求。",
                        retryable: !accepted
                    )
                } catch {
                    let classification = Self.classify(error)
                    try store.completeCriticalMessageAttempt(
                        id: operation.id,
                        accepted: false,
                        errorCode: classification.code,
                        errorMessage: classification.message,
                        retryable: classification.retryable
                    )
                }
            }
            publishSchedule()
        } catch {
            NSLog("Critical Messaging processing failed (%@): %@", reason, String(describing: error))
            onUpdate?()
            publishSchedule()
        }
    }

    @MainActor
    private func publishSchedule() {
        onUpdate?()
        onNextActionDate?(store.nextCriticalMessageActionDate())
    }

    private static func classify(_ error: Error) -> (code: String, message: String, retryable: Bool) {
        guard #available(iOS 18.2, *), let messagingError = error as? MSCriticalMessagingError else {
            return ("unknown", "关键短信发送失败：\(error.localizedDescription)", true)
        }
        switch messagingError {
        case .notAuthorized:
            return ("notAuthorized", "这位家人尚未授权接收 Apple 关键短信。", false)
        case .notSupported:
            return ("notSupported", "当前设备或运行状态不支持发送 Apple 关键短信。", false)
        case .invalidAuthenticationRequest:
            return ("invalidAuthorization", "关键短信收件人授权无效，需要重新设置。", false)
        case .sendFailed:
            return ("sendFailed", "蜂窝网络、SIM 卡、号码或系统频率限制导致发送失败。", true)
        case .unknown:
            return ("unknown", "Apple 关键短信返回未知错误。", true)
        @unknown default:
            return ("unknown", "Apple 关键短信返回未知错误。", true)
        }
    }
}
