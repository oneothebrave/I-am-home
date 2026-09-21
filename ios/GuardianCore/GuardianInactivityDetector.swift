import Foundation

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

    /// Returns true once for each uninterrupted period without movement while away from home.
    mutating func evaluate(at date: Date, thresholdMinutes: Int) -> Bool {
        guard homePresence == .away, alertEmittedAt == nil,
              (30...240).contains(thresholdMinutes),
              let anchor = [awaySince, lastMovementAt].compactMap({ $0 }).max(),
              date >= anchor.addingTimeInterval(TimeInterval(thresholdMinutes * 60))
        else { return false }
        alertEmittedAt = date
        return true
    }

    private func later(_ lhs: Date?, _ rhs: Date) -> Date {
        guard let lhs else { return rhs }
        return max(lhs, rhs)
    }
}
