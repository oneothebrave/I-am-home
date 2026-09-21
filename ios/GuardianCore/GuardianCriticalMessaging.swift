import Foundation
import Messages

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
    case sent
    case failed
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
    var sentAt: Date?
    var lastError: String?
    var shortcutAttemptPending: Bool?
    var shortcutAttemptedAt: Date?
    var shortcutOpenSucceeded: Bool?
    var shortcutAttemptError: String?
    var detectionContext: String?

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
        return contacts.sorted(by: { $0.priority < $1.priority }).enumerated().map { index, contact in
            GuardianCriticalMessageOperation(
                id: "\(event.id):\(contact.id)",
                eventId: event.id,
                contactId: contact.id,
                contactName: contact.name,
                phoneNumber: contact.phoneNumber,
                messageText: message,
                createdAt: event.timestamp,
                status: .prepared,
                shortcutAttemptPending: index == 0
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

    func toDictionary() -> [String: Any] {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        var payload: [String: Any] = [
            "id": id,
            "eventId": eventId,
            "contactId": contactId,
            "contactName": contactName,
            "phoneNumber": phoneNumber,
            "messageText": messageText,
            "createdAt": formatter.string(from: createdAt),
            "status": status.rawValue,
            "shortcutAttemptPending": shortcutAttemptPending == true
        ]
        if let sentAt { payload["sentAt"] = formatter.string(from: sentAt) }
        if let lastError { payload["lastError"] = lastError }
        if let shortcutAttemptedAt {
            payload["shortcutAttemptedAt"] = formatter.string(from: shortcutAttemptedAt)
        }
        if let shortcutOpenSucceeded { payload["shortcutOpenSucceeded"] = shortcutOpenSucceeded }
        if let shortcutAttemptError { payload["shortcutAttemptError"] = shortcutAttemptError }
        if let detectionContext { payload["detectionContext"] = detectionContext }
        return payload
    }
}

enum GuardianShortcutNotification {
    static let name = "到家了么短信通知 V3"

    static func url(for operation: GuardianCriticalMessageOperation) -> URL? {
        guard let data = try? JSONSerialization.data(withJSONObject: [
            "phone": operation.phoneNumber,
            "message": operation.messageText
        ]), let payload = String(data: data, encoding: .utf8) else { return nil }
        var components = URLComponents()
        components.scheme = "shortcuts"
        components.host = "run-shortcut"
        components.queryItems = [
            URLQueryItem(name: "name", value: name),
            URLQueryItem(name: "input", value: "text"),
            URLQueryItem(name: "text", value: payload)
        ]
        return components.url
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
        let recipients = contacts.map { MSRecipient(phoneNumber: $0.phoneNumber) }
        let result = try await messenger.requestAuthorization(for: recipients)
        return Dictionary(uniqueKeysWithValues: result.map { recipient, status in
            (recipient.phoneNumber, Self.authorizationLabel(status))
        })
    }

    func checkAuthorization(for contacts: [GuardianNotificationContact]) async throws -> [String: String] {
        let recipients = contacts.map { MSRecipient(phoneNumber: $0.phoneNumber) }
        let result = try await messenger.checkAuthorizationStatus(for: recipients)
        return Dictionary(uniqueKeysWithValues: result.map { recipient, status in
            (recipient.phoneNumber, Self.authorizationLabel(status))
        })
    }

    func send(_ operation: GuardianCriticalMessageOperation) async throws -> Bool {
        try await messenger.send(
            MSCriticalMessage(messageText: operation.messageText),
            to: MSRecipient(phoneNumber: operation.phoneNumber)
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
