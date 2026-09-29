import Foundation
import CoreFoundation

enum GuardianMonitoringMode: String, Codable {
    case standard, test
}

struct GuardianMonitoringPolicy: Codable, Equatable {
    var mode: GuardianMonitoringMode = .test
    var noMotionThresholdMinutes = 120
    var locationLostThresholdMinutes = 120

    init(mode: GuardianMonitoringMode = .test, noMotionThresholdMinutes: Int = 120,
         locationLostThresholdMinutes: Int = 120) {
        self.mode = mode
        self.noMotionThresholdMinutes = noMotionThresholdMinutes
        self.locationLostThresholdMinutes = locationLostThresholdMinutes
    }

    init(dictionary: [String: Any]) throws {
        guard let rawMode = dictionary["monitoringMode"] as? String,
              let mode = GuardianMonitoringMode(rawValue: rawMode),
              let inactivity = dictionary["noMotionThresholdMinutes"] as? NSNumber,
              let location = dictionary["locationLostThresholdMinutes"] as? NSNumber,
              inactivity.doubleValue == Double(inactivity.intValue),
              location.doubleValue == Double(location.intValue),
              CFGetTypeID(inactivity) != CFBooleanGetTypeID(),
              CFGetTypeID(location) != CFBooleanGetTypeID()
        else { throw GuardianCoreError.invalidConfiguration }
        self.init(mode: mode, noMotionThresholdMinutes: inactivity.intValue,
                  locationLostThresholdMinutes: location.intValue)
        try validate()
    }

    func validate() throws {
        let minimum = mode == .test ? 1 : 15
        guard (minimum...240).contains(noMotionThresholdMinutes),
              (minimum...240).contains(locationLostThresholdMinutes)
        else { throw GuardianCoreError.invalidConfiguration }
    }
}

enum GuardianLocationRiskReason: String, Codable {
    case locationServicesDisabled, locationPermissionDisabled, preciseLocationDisabled
    case backgroundRefreshDisabled, locationFailed, locationStale

    var explanation: String {
        switch self {
        case .locationServicesDisabled: return "系统定位服务已关闭，无法继续取得可信位置。"
        case .locationPermissionDisabled: return "未获始终定位权限，后台位置守护不可用。"
        case .preciseLocationDisabled: return "精确位置已关闭，无法可靠判断守护地点。"
        case .backgroundRefreshDisabled: return "后台 App 刷新不可用，系统可能无法重新唤醒守护。"
        case .locationFailed: return "持续未取得可信位置，最近一次定位请求失败。"
        case .locationStale: return "家外守护时段内已长时间没有新的可信位置。"
        }
    }
}

struct GuardianRiskCheck {
    let date: Date
    let enabled: Bool
    let homePresence: GuardianHomePresence
    // Only expect recurring GPS during the existing away/active-window tracking period.
    let expectsLocation: Bool
    let locationBlocker: GuardianLocationRiskReason?
    let batteryLevel: Int?
    let isCharging: Bool?
    var trustedLocationAt: Date? = nil
    var locationFailed = false
    var activePeriodStart: Date? = nil
}

enum GuardianRiskTransition: Equatable {
    case lowBattery, batteryRecovered
    case locationLost(GuardianLocationRiskReason), locationRestored
    case locationPeriodReset
}

// Pure, persisted detector. It evaluates only when iOS grants execution time.
struct GuardianRiskState: Codable, Equatable {
    var lowBatteryActive = false
    var locationReason: GuardianLocationRiskReason?
    var locationRiskStartedAt: Date?
    var waitingForLocationSince: Date?
    var lastTrustedLocationAt: Date?
    var lastLocationFailureAt: Date?
    var lastCheckAt: Date?

    mutating func evaluate(_ check: GuardianRiskCheck,
                           policy: GuardianMonitoringPolicy) -> [GuardianRiskTransition] {
        var changes: [GuardianRiskTransition] = []
        if let lastCheckAt, check.date < lastCheckAt {
            // A clock rollback must not extend an old deadline indefinitely.
            waitingForLocationSince = check.date
            if lastTrustedLocationAt.map({ $0 > check.date }) == true { lastTrustedLocationAt = nil }
            lastLocationFailureAt = nil
            if locationRiskStartedAt != nil { locationRiskStartedAt = check.date }
        }
        lastCheckAt = check.date
        if let observed = check.trustedLocationAt,
           observed <= check.date.addingTimeInterval(5),
           check.date.timeIntervalSince(observed) <= 120,
           lastTrustedLocationAt.map({ observed > $0 }) ?? true {
            lastTrustedLocationAt = min(observed, check.date)
            if lastLocationFailureAt.map({ observed >= $0 }) ?? true { lastLocationFailureAt = nil }
        }
        if check.locationFailed { lastLocationFailureAt = check.date }

        let battery = check.batteryLevel.flatMap { (0...100).contains($0) ? $0 : nil }
        let batteryRecovered = !check.enabled || check.homePresence == .home ||
            check.isCharging == true || battery.map { $0 >= 20 } == true
        if lowBatteryActive && batteryRecovered {
            lowBatteryActive = false
            changes.append(.batteryRecovered)
        } else if !lowBatteryActive, check.enabled, check.homePresence == .away,
                  check.isCharging == false, let battery, battery < 20 {
            lowBatteryActive = true
            changes.append(.lowBattery)
        }

        if check.expectsLocation, let period = check.activePeriodStart,
           let waiting = waitingForLocationSince, waiting < period, period <= check.date {
            // We may have slept through the entire rest period. Do not carry its
            // elapsed time into today's window or revive yesterday's stale-fix alert.
            waitingForLocationSince = check.date
            if lastLocationFailureAt.map({ $0 < period }) == true { lastLocationFailureAt = nil }
            if locationReason == .locationStale || locationReason == .locationFailed {
                locationReason = nil
                locationRiskStartedAt = nil
                changes.append(.locationPeriodReset)
            }
        }
        let previousReason = locationReason
        if !check.enabled {
            waitingForLocationSince = nil
            locationReason = nil
        } else if let blocker = check.locationBlocker {
            locationReason = blocker
            if waitingForLocationSince == nil { waitingForLocationSince = check.date }
        } else if !check.expectsLocation {
            // At home and outside the active window GPS is intentionally not continuous.
            waitingForLocationSince = nil
            locationReason = nil
        } else {
            if waitingForLocationSince == nil { waitingForLocationSince = check.date }
            let anchor = max(waitingForLocationSince!, lastTrustedLocationAt ?? .distantPast)
            let overdue = check.date.timeIntervalSince(anchor) >=
                TimeInterval(policy.locationLostThresholdMinutes * 60)
            let awaitingRecovery = locationRiskStartedAt.map { started in
                lastTrustedLocationAt.map {
                    $0 < started || check.date.timeIntervalSince($0) > 120
                } ?? true
            } ?? false
            locationReason = overdue || awaitingRecovery
                ? (lastLocationFailureAt != nil ? .locationFailed : .locationStale) : nil
        }
        if previousReason == nil, let reason = locationReason {
            locationRiskStartedAt = check.date
            changes.append(.locationLost(reason))
        } else if previousReason != nil && locationReason == nil {
            locationRiskStartedAt = nil
            changes.append(.locationRestored)
        }
        return changes
    }

    func nextEvaluationDate(policy: GuardianMonitoringPolicy, after date: Date) -> Date? {
        guard locationReason == nil, let since = waitingForLocationSince else { return nil }
        let due = max(since, lastTrustedLocationAt ?? .distantPast)
            .addingTimeInterval(TimeInterval(policy.locationLostThresholdMinutes * 60))
        return max(due, date.addingTimeInterval(5))
    }

    var dictionary: [String: Any] {
        var value: [String: Any] = ["lowBatteryActive": lowBatteryActive]
        if let locationReason { value["locationReason"] = locationReason.rawValue }
        if let lastTrustedLocationAt { value["lastTrustedLocationAt"] = lastTrustedLocationAt.timeIntervalSince1970 * 1000 }
        if let lastCheckAt { value["lastCheckAt"] = lastCheckAt.timeIntervalSince1970 * 1000 }
        return value
    }
}
