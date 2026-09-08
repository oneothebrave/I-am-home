import Foundation
import CoreLocation

enum GuardianEventType: String, Codable {
    case leaveHome = "LEAVE_HOME", enterWorkArea = "ENTER_WORK_AREA", exitWorkArea = "EXIT_WORK_AREA"
    case returnHome = "RETURN_HOME", longStay = "LONG_STAY", lowBattery = "LOW_BATTERY"
    case locationLost = "LOCATION_LOST", locationUpdated = "LOCATION_UPDATED"
    case enterWaypoint = "ENTER_WAYPOINT", exitWaypoint = "EXIT_WAYPOINT"
    case motionDetected = "MOTION_DETECTED", noMotionForLongTime = "NO_MOTION_FOR_LONG_TIME"
    case safetyCheckRequested = "SAFETY_CHECK_REQUESTED", familyNotified = "FAMILY_NOTIFIED"
    case familyNotificationFailed = "FAMILY_NOTIFICATION_FAILED", familyAcknowledged = "FAMILY_ACKNOWLEDGED"
    case escalationFinished = "ESCALATION_FINISHED", userConfirmedSafe = "USER_CONFIRMED_SAFE"
    case sosSent = "SOS_SENT", riskEscalated = "RISK_ESCALATED"
}

struct GuardianPoint: Codable {
    let latitude: Double
    let longitude: Double
    let accuracy: Double?
    var coordinate: CLLocationCoordinate2D { CLLocationCoordinate2D(latitude: latitude, longitude: longitude) }
}

struct GuardianEvent: Codable {
    let id: String
    let type: GuardianEventType
    let title: String
    let description: String
    let timestamp: Date
    let receivedAt: Date
    let source: String
    let location: GuardianPoint?
    let batteryLevel: Int?
    let geofenceId: String?
    let locationLabel: String?

    init(type: GuardianEventType, title: String, description: String, timestamp: Date, source: String,
         location: CLLocation? = nil, batteryLevel: Float? = nil, geofenceId: String? = nil, locationLabel: String? = nil) {
        id = UUID().uuidString
        self.type = type
        self.title = title
        self.description = description
        self.timestamp = timestamp
        receivedAt = Date()
        self.source = source
        self.location = location.map { GuardianPoint(latitude: $0.coordinate.latitude, longitude: $0.coordinate.longitude, accuracy: $0.horizontalAccuracy >= 0 ? $0.horizontalAccuracy : nil) }
        self.batteryLevel = batteryLevel.flatMap { $0.isFinite && (0...1).contains($0) ? Int(($0 * 100).rounded()) : nil }
        self.geofenceId = geofenceId
        self.locationLabel = locationLabel
    }

    func toDictionary() -> [String: Any] {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        var payload: [String: Any] = ["id": id, "type": type.rawValue, "title": title, "description": description,
                                      "timestamp": formatter.string(from: timestamp), "receivedAt": formatter.string(from: receivedAt), "source": source]
        if let location {
            var point: [String: Any] = ["latitude": location.latitude, "longitude": location.longitude]
            if let accuracy = location.accuracy { point["accuracy"] = accuracy }
            payload["location"] = point
        }
        if let batteryLevel { payload["batteryLevel"] = batteryLevel }
        if let geofenceId { payload["geofenceId"] = geofenceId }
        if let locationLabel { payload["locationLabel"] = locationLabel }
        return payload
    }
}
