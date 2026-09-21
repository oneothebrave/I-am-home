import CoreLocation

struct GuardianMovementAnchor: Codable {
    let latitude: Double
    let longitude: Double
    let accuracy: Double
    let timestamp: Date

    init(_ location: CLLocation) {
        latitude = location.coordinate.latitude
        longitude = location.coordinate.longitude
        accuracy = location.horizontalAccuracy
        timestamp = location.timestamp
    }

    var location: CLLocation {
        CLLocation(coordinate: CLLocationCoordinate2D(latitude: latitude, longitude: longitude),
                   altitude: 0, horizontalAccuracy: accuracy, verticalAccuracy: -1, timestamp: timestamp)
    }
}

struct GuardianLocationMovementAssessment {
    let distanceMeters: Double
    let requiredDistanceMeters: Double
    let hasCredibleSpeed: Bool

    var indicatesMovement: Bool {
        // Displacement alone is not activity: even a nominally precise stationary fix can
        // jump tens of metres. Core Location speed is the independent corroborating signal.
        distanceMeters > requiredDistanceMeters && hasCredibleSpeed
    }
}

enum GuardianLocationPolicy {
    static let minimumStepDelta = 5

    static func accepts(_ location: CLLocation, now: Date = Date()) -> Bool {
        let age = now.timeIntervalSince(location.timestamp)
        return (-5...120).contains(age) && location.horizontalAccuracy.isFinite
            && (0...100).contains(location.horizontalAccuracy) && CLLocationCoordinate2DIsValid(location.coordinate)
    }

    static func indicatesMotion(from previous: CLLocation?, to current: CLLocation) -> Bool {
        movementAssessment(from: previous, to: current)?.indicatesMovement == true
    }

    static func movementAssessment(
        from previous: CLLocation?,
        to current: CLLocation
    ) -> GuardianLocationMovementAssessment? {
        guard let previous, current.timestamp > previous.timestamp,
              previous.horizontalAccuracy >= 0, current.horizontalAccuracy >= 0 else { return nil }
        // Independent accuracy errors combine quadratically. The multiplier and 8 m floor
        // reject ordinary GPS jitter without imposing a fixed 20 m requirement.
        let combinedAccuracy = hypot(previous.horizontalAccuracy, current.horizontalAccuracy)
        return GuardianLocationMovementAssessment(
            distanceMeters: current.distance(from: previous),
            requiredDistanceMeters: max(8, combinedAccuracy * 1.25),
            hasCredibleSpeed: current.speed.isFinite && current.speed >= 0.8
        )
    }

    static func indicatesPedometerMovement(totalSteps: Int, lastAcceptedSteps: Int) -> Bool {
        totalSteps - lastAcceptedSteps >= minimumStepDelta
    }
}
