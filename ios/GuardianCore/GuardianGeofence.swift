import Foundation
import CoreLocation

struct GuardianGeofence {
    let id: String
    let name: String
    let kind: String
    let center: CLLocationCoordinate2D
    let radiusMeters: CLLocationDistance

    init?(dictionary: [String: Any]) {
        guard
            let id = dictionary["id"] as? String,
            let name = dictionary["name"] as? String,
            let kind = dictionary["kind"] as? String,
            let radiusMeters = dictionary["radiusMeters"] as? CLLocationDistance,
            let center = dictionary["center"] as? [String: Any],
            let latitude = center["latitude"] as? CLLocationDegrees,
            let longitude = center["longitude"] as? CLLocationDegrees
        else {
            return nil
        }

        self.id = id
        self.name = name
        self.kind = kind
        self.center = CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
        self.radiusMeters = radiusMeters
    }

    func region() -> CLCircularRegion {
        let region = CLCircularRegion(center: center, radius: radiusMeters, identifier: id)
        region.notifyOnEntry = true
        region.notifyOnExit = true
        return region
    }
}
