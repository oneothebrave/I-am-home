import CoreLocation
import UIKit

final class GuardianLocationService: NSObject, CLLocationManagerDelegate {
    private typealias LocationRequest = (Result<CLLocation, Error>) -> Void
    private let manager = CLLocationManager()
    private let store: GuardianEventStore
    private var geofencesById: [String: GuardianGeofence] = [:]
    private var previousLocation: CLLocation?
    private var locationRequest: LocationRequest?
    private var locationRequestTimeout: DispatchWorkItem?
    private(set) var isMonitoring = false
    var onEvent: ((GuardianEvent) -> Void)?
    var onError: ((Error) -> Void)?
    var authorization: CLAuthorizationStatus { manager.authorizationStatus }
    var accuracyAuthorization: CLAccuracyAuthorization { manager.accuracyAuthorization }

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
        guard accuracyAuthorization == .fullAccuracy else { throw GuardianCoreError.missingPreciseLocation }
        guard hasBackgroundMode else { throw GuardianCoreError.missingBackgroundMode }
        guard CLLocationManager.significantLocationChangeMonitoringAvailable(), CLLocationManager.isMonitoringAvailable(for: CLCircularRegion.self) else { throw GuardianCoreError.unavailable }
        guard !geofences.isEmpty else { throw GuardianCoreError.invalidConfiguration }
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

    func requestCurrentLocation(completion: @escaping (Result<CLLocation, Error>) -> Void) throws {
        guard CLLocationManager.locationServicesEnabled() else { throw GuardianCoreError.unavailable }
        guard authorization == .authorizedWhenInUse || authorization == .authorizedAlways else {
            throw GuardianCoreError.missingPermissions
        }
        guard accuracyAuthorization == .fullAccuracy else { throw GuardianCoreError.missingPreciseLocation }
        guard locationRequest == nil else { throw GuardianCoreError.locationRequestInProgress }

        locationRequest = completion
        manager.desiredAccuracy = kCLLocationAccuracyBest
        let timeout = DispatchWorkItem { [weak self] in
            self?.finishLocationRequest(.failure(GuardianCoreError.locationTimedOut))
        }
        locationRequestTimeout = timeout
        DispatchQueue.main.asyncAfter(deadline: .now() + 15, execute: timeout)
        manager.requestLocation()
    }

    private func validateSupported(_ fences: [GuardianGeofence]) throws {
        try GuardianGeofence.validate(fences)
        guard fences.allSatisfy({ $0.radiusMeters <= manager.maximumRegionMonitoringDistance }) else { throw GuardianCoreError.invalidConfiguration }
    }

    func restore() {
        guard store.enabled, authorization == .authorizedAlways,
              accuracyAuthorization == .fullAccuracy, hasBackgroundMode else { stopMonitoring(); return }
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

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        if locationRequest != nil && authorization != .authorizedWhenInUse && authorization != .authorizedAlways {
            finishLocationRequest(.failure(GuardianCoreError.missingPermissions))
        }
        restore()
    }
    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        if locationRequest != nil {
            finishLocationRequest(.failure(error))
            return
        }
        onError?(error)
    }
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
        if locationRequest != nil {
            let accepted = locations
                .filter { GuardianLocationPolicy.accepts($0) }
                .sorted {
                    $0.horizontalAccuracy == $1.horizontalAccuracy
                        ? $0.timestamp > $1.timestamp
                        : $0.horizontalAccuracy < $1.horizontalAccuracy
                }
            finishLocationRequest(
                accepted.first.map { .success($0) }
                    ?? .failure(GuardianCoreError.invalidLocationSample)
            )
        }
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

    private func finishLocationRequest(_ result: Result<CLLocation, Error>) {
        guard let completion = locationRequest else { return }
        locationRequest = nil
        locationRequestTimeout?.cancel()
        locationRequestTimeout = nil
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
        completion(result)
    }
}
