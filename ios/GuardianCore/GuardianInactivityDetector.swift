import Foundation

struct GuardianActiveWindow: Codable, Equatable {
    let startMinuteOfDay: Int
    let endMinuteOfDay: Int

    init(dictionary: [String: Any]) throws {
        guard let startTime = dictionary["startTime"] as? String,
              let endTime = dictionary["expectedReturnTime"] as? String
        else { throw GuardianCoreError.invalidConfiguration }
        startMinuteOfDay = try Self.parse(startTime)
        endMinuteOfDay = try Self.parse(endTime)
        guard startMinuteOfDay < endMinuteOfDay else {
            throw GuardianCoreError.invalidConfiguration
        }
    }

    init(startTime: String, endTime: String) throws {
        startMinuteOfDay = try Self.parse(startTime)
        endMinuteOfDay = try Self.parse(endTime)
        guard startMinuteOfDay < endMinuteOfDay else {
            throw GuardianCoreError.invalidConfiguration
        }
    }

    func contains(_ date: Date, calendar: Calendar = .current) -> Bool {
        let components = calendar.dateComponents([.hour, .minute], from: date)
        guard let hour = components.hour, let minute = components.minute else { return false }
        let minuteOfDay = hour * 60 + minute
        return minuteOfDay >= startMinuteOfDay && minuteOfDay < endMinuteOfDay
    }

    func periodStart(containing date: Date, calendar: Calendar = .current) -> Date? {
        guard contains(date, calendar: calendar) else { return nil }
        return self.date(onSameDayAs: date, minuteOfDay: startMinuteOfDay, calendar: calendar)
    }

    func nextBoundary(after date: Date, calendar: Calendar = .current) -> Date? {
        guard let start = self.date(onSameDayAs: date, minuteOfDay: startMinuteOfDay, calendar: calendar),
              let end = self.date(onSameDayAs: date, minuteOfDay: endMinuteOfDay, calendar: calendar)
        else { return nil }
        if date < start { return start }
        if date < end { return end }
        return calendar.date(byAdding: .day, value: 1, to: start)
    }

    private func date(onSameDayAs date: Date, minuteOfDay: Int, calendar: Calendar) -> Date? {
        var components = calendar.dateComponents([.era, .year, .month, .day], from: date)
        components.hour = minuteOfDay / 60
        components.minute = minuteOfDay % 60
        components.second = 0
        return calendar.date(from: components)
    }

    private static func parse(_ value: String) throws -> Int {
        let parts = value.split(separator: ":", omittingEmptySubsequences: false)
        guard parts.count == 2,
              parts[0].count == 2,
              parts[1].count == 2,
              let hour = Int(parts[0]),
              let minute = Int(parts[1]),
              (0...23).contains(hour),
              (0...59).contains(minute)
        else { throw GuardianCoreError.invalidConfiguration }
        return hour * 60 + minute
    }
}

enum GuardianHomePresence: String, Codable {
    case unknown
    case home
    case away
}

struct GuardianInactivityState: Codable, Equatable {
    var homePresence: GuardianHomePresence = .unknown
    var awaySince: Date?
    var lastMovementAt: Date?
    var lastTrustedLocationAt: Date?
    var alertEmittedAt: Date?

    mutating func enterHome(at date: Date) {
        homePresence = .home
        awaySince = nil
        lastMovementAt = nil
        alertEmittedAt = nil
        lastTrustedLocationAt = later(lastTrustedLocationAt, date)
    }

    mutating func leaveHome(at date: Date) {
        guard homePresence != .away else {
            lastTrustedLocationAt = later(lastTrustedLocationAt, date)
            return
        }
        homePresence = .away
        awaySince = date
        lastMovementAt = date
        lastTrustedLocationAt = later(lastTrustedLocationAt, date)
        alertEmittedAt = nil
    }

    mutating func observeTrustedLocation(outsideHome: Bool, at date: Date) {
        lastTrustedLocationAt = later(lastTrustedLocationAt, date)
        if outsideHome { leaveHome(at: date) }
        else { enterHome(at: date) }
    }

    /// Returns true only when this movement resolves an already emitted inactivity alert.
    mutating func observeMovement(at date: Date) -> Bool {
        guard homePresence == .away else { return false }
        let anchor = [awaySince, lastMovementAt].compactMap { $0 }.max()
        guard anchor.map({ date > $0 }) ?? true else { return false }
        let resolvesAlert = alertEmittedAt.map { date > $0 } ?? false
        lastMovementAt = date
        if resolvesAlert { alertEmittedAt = nil }
        return resolvesAlert
    }

    mutating func suspendAwayTracking() {
        awaySince = nil
        lastMovementAt = nil
        alertEmittedAt = nil
    }

    mutating func resumeAwayTracking(noEarlierThan date: Date) {
        guard homePresence == .away else { return }
        if awaySince == nil || awaySince! < date { awaySince = date }
        if lastMovementAt == nil || lastMovementAt! < date { lastMovementAt = date }
        if let alertEmittedAt, alertEmittedAt < date { self.alertEmittedAt = nil }
    }

    func nextEvaluationDate(thresholdMinutes: Int) -> Date? {
        guard homePresence == .away, alertEmittedAt == nil,
              (1...240).contains(thresholdMinutes),
              let anchor = [awaySince, lastMovementAt].compactMap({ $0 }).max()
        else { return nil }
        return anchor.addingTimeInterval(TimeInterval(thresholdMinutes * 60))
    }

    /// Returns true once for each uninterrupted period without movement while away from home.
    mutating func evaluate(at date: Date, thresholdMinutes: Int) -> Bool {
        guard let dueAt = nextEvaluationDate(thresholdMinutes: thresholdMinutes),
              date >= dueAt
        else { return false }
        alertEmittedAt = date
        return true
    }

    private func later(_ lhs: Date?, _ rhs: Date) -> Date {
        guard let lhs else { return rhs }
        return max(lhs, rhs)
    }
}
