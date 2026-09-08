import Foundation
import CoreLocation

enum GuardianCoreError: Error {
    case invalidConfiguration, unsupportedVersion, missingPermissions, missingBackgroundMode, unavailable
}

struct GuardianGeofence: Codable {
    let id: String
    let name: String
    let kind: String
    let center: GuardianPoint
    let radiusMeters: Double

    init(dictionary: [String: Any]) throws {
        guard let id = dictionary["id"] as? String, !id.isEmpty,
              let name = dictionary["name"] as? String, !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              let kind = dictionary["kind"] as? String, ["home", "work", "waypoint"].contains(kind),
              let radius = dictionary["radiusMeters"] as? Double, radius.isFinite, (100...1000).contains(radius),
              let center = dictionary["center"] as? [String: Any],
              let latitude = center["latitude"] as? Double, latitude.isFinite, (-90...90).contains(latitude),
              let longitude = center["longitude"] as? Double, longitude.isFinite, (-180...180).contains(longitude)
        else { throw GuardianCoreError.invalidConfiguration }
        self.id = id
        self.name = name
        self.kind = kind
        self.radiusMeters = radius
        self.center = GuardianPoint(latitude: latitude, longitude: longitude, accuracy: nil)
    }

    static func validate(_ fences: [GuardianGeofence]) throws {
        guard fences.count <= 20, Set(fences.map(\.id)).count == fences.count else { throw GuardianCoreError.invalidConfiguration }
        for fence in fences {
            _ = try GuardianGeofence(dictionary: ["id": fence.id, "name": fence.name, "kind": fence.kind,
                "radiusMeters": fence.radiusMeters, "center": ["latitude": fence.center.latitude, "longitude": fence.center.longitude]])
        }
    }

    func region() -> CLCircularRegion {
        let region = CLCircularRegion(center: center.coordinate, radius: radiusMeters, identifier: id)
        region.notifyOnEntry = true
        region.notifyOnExit = true
        return region
    }
}
