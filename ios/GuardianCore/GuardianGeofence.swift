import Foundation
import CoreLocation

enum GuardianCoreError: LocalizedError {
    case invalidConfiguration
    case unsupportedVersion
    case missingPermissions
    case missingPreciseLocation
    case missingBackgroundMode
    case locationRequestInProgress
    case locationTimedOut
    case invalidLocationSample
    case unavailable

    var errorDescription: String? {
        switch self {
        case .invalidConfiguration: return "守护地点配置无效。"
        case .unsupportedVersion: return "本机守护数据版本不受支持。"
        case .missingPermissions: return "请先允许此 App 使用定位。"
        case .missingPreciseLocation: return "请在系统设置中为此 App 开启精确位置。"
        case .missingBackgroundMode: return "工程尚未启用后台定位能力。"
        case .locationRequestInProgress: return "正在获取位置，请稍候。"
        case .locationTimedOut: return "获取当前位置超时，请到开阔处后重试。"
        case .invalidLocationSample: return "当前位置过旧或精度不足 100 米，请稍后重试。"
        case .unavailable: return "当前设备无法使用所需的定位能力。"
        }
    }
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

    func matches(_ region: CLCircularRegion) -> Bool {
        region.identifier == id &&
            abs(region.center.latitude - center.latitude) < 0.000_001 &&
            abs(region.center.longitude - center.longitude) < 0.000_001 &&
            abs(region.radius - radiusMeters) < 0.5 &&
            region.notifyOnEntry && region.notifyOnExit
    }
}
