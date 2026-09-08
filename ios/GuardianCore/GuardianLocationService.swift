import CoreLocation
import UIKit

final class GuardianLocationService: NSObject, CLLocationManagerDelegate {
    private let manager = CLLocationManager()
    private let store: GuardianEventStore
    private var geofencesById: [String: GuardianGeofence] = [:]
    private var previousLocation: CLLocation?
    private(set) var isMonitoring = false
    var onEvent: ((GuardianEvent) -> Void)?
    var onError: ((Error) -> Void)?
    var authorization: CLAuthorizationStatus { manager.authorizationStatus }

    init(store: GuardianEventStore) {
        self.store = store
        super.init()
        geofencesById = Dictionary(uniqueKeysWithValues: store.geofences.map { ($0.id, $0) })
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
        manager.pausesLocationUpdatesAutomatically = true
        manager.allowsBackgroundLocationUpdates = hasBackgroundMode
        UIDevice.current.isBatteryMonitoringEnabled = true
    }

    private var hasBackgroundMode: Bool {
        (Bundle.main.object(forInfoDictionaryKey: "UIBackgroundModes") as? [String])?.contains("location") == true
    }

    func requestPermissions() throws {
        guard Bundle.main.object(forInfoDictionaryKey: "NSLocationWhenInUseUsageDescription") != nil,
              Bundle.main.object(forInfoDictionaryKey: "NSLocationAlwaysAndWhenInUseUsageDescription") != nil else { throw GuardianCoreError.missingPermissions }
        if authorization == .notDetermined { manager.requestWhenInUseAuthorization() }
        else if authorization == .authorizedWhenInUse { manager.requestAlwaysAuthorization() }
    }

    func start(geofences: [GuardianGeofence]) throws {
        guard authorization == .authorizedAlways else { throw GuardianCoreError.missingPermissions }
        guard hasBackgroundMode else { throw GuardianCoreError.missingBackgroundMode }
        guard CLLocationManager.significantLocationChangeMonitoringAvailable(), CLLocationManager.isMonitoringAvailable(for: CLCircularRegion.self) else { throw GuardianCoreError.unavailable }
        try validateSupported(geofences)
        try store.configure(enabled: true, geofences: geofences)
        restore()
    }

    func stop() throws {
        stopMonitoring()
        try store.configure(enabled: false, geofences: store.geofences)
    }

    func setGeofences(_ geofences: [GuardianGeofence]) throws {
        try validateSupported(geofences)
        try store.configure(enabled: store.enabled, geofences: geofences)
        geofencesById = Dictionary(uniqueKeysWithValues: geofences.map { ($0.id, $0) })
        if store.enabled { restore() }
    }

    private func validateSupported(_ fences: [GuardianGeofence]) throws {
        try GuardianGeofence.validate(fences)
        guard fences.allSatisfy({ $0.radiusMeters <= manager.maximumRegionMonitoringDistance }) else { throw GuardianCoreError.invalidConfiguration }
    }

    func restore() {
        guard store.enabled, authorization == .authorizedAlways, hasBackgroundMode else { stopMonitoring(); return }
        geofencesById = Dictionary(uniqueKeysWithValues: store.geofences.map { ($0.id, $0) })
        manager.monitoredRegions.forEach { manager.stopMonitoring(for: $0) }
        for fence in store.geofences { manager.startMonitoring(for: fence.region()) }
        manager.startMonitoringSignificantLocationChanges()
        isMonitoring = true
    }

    private func stopMonitoring() {
        manager.stopMonitoringSignificantLocationChanges()
        manager.monitoredRegions.forEach { manager.stopMonitoring(for: $0) }
        isMonitoring = false
        previousLocation = nil
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) { restore() }
    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) { onError?(error) }
    func locationManager(_ manager: CLLocationManager, monitoringDidFailFor region: CLRegion?, withError error: Error) {
        isMonitoring = false
        onError?(error)
    }

    func locationManager(_ manager: CLLocationManager, didEnterRegion region: CLRegion) {
        guard isMonitoring, let fence = geofencesById[region.identifier] else { return }
        let type: GuardianEventType = fence.kind == "home" ? .returnHome : fence.kind == "work" ? .enterWorkArea : .enterWaypoint
        emit(type, fence: fence, title: "进入\(fence.name)")
    }

    func locationManager(_ manager: CLLocationManager, didExitRegion region: CLRegion) {
        guard isMonitoring, let fence = geofencesById[region.identifier] else { return }
        let type: GuardianEventType = fence.kind == "home" ? .leaveHome : fence.kind == "work" ? .exitWorkArea : .exitWaypoint
        emit(type, fence: fence, title: "离开\(fence.name)")
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard isMonitoring else { return }
        for location in locations.sorted(by: { $0.timestamp < $1.timestamp }) {
            guard GuardianLocationPolicy.accepts(location), previousLocation.map({ location.timestamp > $0.timestamp }) ?? true else { continue }
            let moved = GuardianLocationPolicy.indicatesMotion(from: previousLocation, to: location)
            previousLocation = location
            onEvent?(GuardianEvent(type: moved ? .motionDetected : .locationUpdated,
                title: moved ? "检测到可信移动" : "更新当前位置", description: moved ? "新定位显示手机发生了可信移动。" : "收到有效位置，尚不能据此判断移动。",
                timestamp: location.timestamp, source: "location", location: location, batteryLevel: UIDevice.current.batteryLevel))
        }
    }

    private func emit(_ type: GuardianEventType, fence: GuardianGeofence, title: String) {
        // A boundary event identifies a region, not an exact GPS fix at its center.
        onEvent?(GuardianEvent(type: type, title: title, description: "\(title)的守护范围。", timestamp: Date(), source: "geofence",
            batteryLevel: UIDevice.current.batteryLevel, geofenceId: fence.id, locationLabel: "\(fence.name)附近"))
    }
}
