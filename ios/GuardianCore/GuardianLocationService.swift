import CoreLocation
import UIKit

final class GuardianLocationService: NSObject, CLLocationManagerDelegate {
    private let locationManager = CLLocationManager()
    private var geofencesById: [String: GuardianGeofence] = [:]
    var onEvent: ((GuardianEvent) -> Void)?

    override init() {
        super.init()
        locationManager.delegate = self
        locationManager.desiredAccuracy = kCLLocationAccuracyHundredMeters
        locationManager.allowsBackgroundLocationUpdates = true
        locationManager.pausesLocationUpdatesAutomatically = true
        UIDevice.current.isBatteryMonitoringEnabled = true
    }

    func requestPermissions() {
        locationManager.requestAlwaysAuthorization()
    }

    func start() {
        locationManager.startMonitoringSignificantLocationChanges()
    }

    func stop() {
        locationManager.stopMonitoringSignificantLocationChanges()
        locationManager.monitoredRegions.forEach { locationManager.stopMonitoring(for: $0) }
    }

    func setGeofences(_ geofences: [GuardianGeofence]) {
        locationManager.monitoredRegions.forEach { locationManager.stopMonitoring(for: $0) }
        geofencesById = Dictionary(uniqueKeysWithValues: geofences.map { ($0.id, $0) })

        geofences.prefix(20).forEach { geofence in
            locationManager.startMonitoring(for: geofence.region())
        }
    }

    func locationManager(_ manager: CLLocationManager, didEnterRegion region: CLRegion) {
        guard let geofence = geofencesById[region.identifier] else { return }
        let eventType: GuardianEventType = geofence.kind == "home" ? .returnHome : .enterWorkArea
        emitGeofenceEvent(type: eventType, geofence: geofence, title: "进入\(geofence.name)")
    }

    func locationManager(_ manager: CLLocationManager, didExitRegion region: CLRegion) {
        guard let geofence = geofencesById[region.identifier] else { return }
        let eventType: GuardianEventType = geofence.kind == "home" ? .leaveHome : .exitWorkArea
        emitGeofenceEvent(type: eventType, geofence: geofence, title: "离开\(geofence.name)")
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let latestLocation = locations.last else { return }
        onEvent?(
            GuardianEvent(
                type: .motionDetected,
                title: "检测到位置变化",
                description: "手机位置出现变化，可作为一条安全信号。",
                timestamp: Date(),
                source: "location",
                location: latestLocation,
                batteryLevel: UIDevice.current.batteryLevel
            )
        )
    }

    private func emitGeofenceEvent(type: GuardianEventType, geofence: GuardianGeofence, title: String) {
        let location = CLLocation(latitude: geofence.center.latitude, longitude: geofence.center.longitude)
        onEvent?(
            GuardianEvent(
                type: type,
                title: title,
                description: "\(title)的地理围栏范围。",
                timestamp: Date(),
                source: "geofence",
                location: location,
                batteryLevel: UIDevice.current.batteryLevel
            )
        )
    }
}
