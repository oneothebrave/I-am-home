import Foundation
import CoreLocation

enum GuardianEventType: String {
    case leaveHome = "LEAVE_HOME"
    case enterWorkArea = "ENTER_WORK_AREA"
    case exitWorkArea = "EXIT_WORK_AREA"
    case returnHome = "RETURN_HOME"
    case longStay = "LONG_STAY"
    case lowBattery = "LOW_BATTERY"
    case locationLost = "LOCATION_LOST"
    case motionDetected = "MOTION_DETECTED"
    case noMotionForLongTime = "NO_MOTION_FOR_LONG_TIME"
    case safetyCheckRequested = "SAFETY_CHECK_REQUESTED"
    case familyNotified = "FAMILY_NOTIFIED"
    case escalationFinished = "ESCALATION_FINISHED"
    case userConfirmedSafe = "USER_CONFIRMED_SAFE"
    case sosSent = "SOS_SENT"
    case riskEscalated = "RISK_ESCALATED"
}

struct GuardianEvent {
    let type: GuardianEventType
    let title: String
    let description: String
    let timestamp: Date
    let source: String
    let location: CLLocation?
    let batteryLevel: Float?

    func toDictionary() -> [String: Any] {
        var payload: [String: Any] = [
            "id": UUID().uuidString,
            "type": type.rawValue,
            "title": title,
            "description": description,
            "timestamp": ISO8601DateFormatter().string(from: timestamp),
            "source": source
        ]

        if let location {
            payload["location"] = [
                "latitude": location.coordinate.latitude,
                "longitude": location.coordinate.longitude,
                "accuracy": location.horizontalAccuracy
            ]
        }

        if let batteryLevel {
            payload["batteryLevel"] = Int(batteryLevel * 100)
        }

        return payload
    }
}
