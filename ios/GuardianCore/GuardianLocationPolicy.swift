import CoreLocation

enum GuardianLocationPolicy {
    static func accepts(_ location: CLLocation, now: Date = Date()) -> Bool {
        let age = now.timeIntervalSince(location.timestamp)
        return (-5...120).contains(age) && location.horizontalAccuracy.isFinite
            && (0...100).contains(location.horizontalAccuracy) && CLLocationCoordinate2DIsValid(location.coordinate)
    }

    static func indicatesMotion(from previous: CLLocation?, to current: CLLocation) -> Bool {
        guard let previous, current.timestamp > previous.timestamp,
              current.timestamp.timeIntervalSince(previous.timestamp) <= 120 else { return false }
        let uncertainty = previous.horizontalAccuracy + current.horizontalAccuracy
        return current.distance(from: previous) > max(50, uncertainty)
    }
}
