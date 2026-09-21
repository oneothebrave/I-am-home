import CoreLocation
import CoreMotion
import UIKit

final class GuardianLocationService: NSObject, CLLocationManagerDelegate {
    private typealias LocationRequest = (Result<CLLocation, Error>) -> Void
    private let manager = CLLocationManager()
    private let activityManager = CMMotionActivityManager()
    private let pedometer = CMPedometer()
    private let store: GuardianEventStore
    private var geofencesById: [String: GuardianGeofence] = [:]
    private var homeRegionStates: [String: CLRegionState] = [:]
    private var previousLocation: CLLocation?
    private var locationRequest: LocationRequest?
    private var locationRequestTimeout: DispatchWorkItem?
    private var inactivityTimer: Timer?
    private var lastPedometerSteps: Int?
    private var isReceivingStandardLocations = false
    private var isReceivingMotion = false
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
        manager.distanceFilter = 50
        manager.pausesLocationUpdatesAutomatically = true
        manager.allowsBackgroundLocationUpdates = hasBackgroundMode
        manager.showsBackgroundLocationIndicator = false
        UIDevice.current.isBatteryMonitoringEnabled = true
    }

    private var hasBackgroundMode: Bool {
        (Bundle.main.object(forInfoDictionaryKey: "UIBackgroundModes") as? [String])?.contains("location") == true
    }

    private var homeGeofences: [GuardianGeofence] {
        store.geofences.filter { $0.kind == "home" }
    }

    func requestPermissions() throws {
        guard Bundle.main.object(forInfoDictionaryKey: "NSLocationWhenInUseUsageDescription") != nil,
              Bundle.main.object(forInfoDictionaryKey: "NSLocationAlwaysAndWhenInUseUsageDescription") != nil else { throw GuardianCoreError.missingPermissions }
        if authorization == .notDetermined { manager.requestWhenInUseAuthorization() }
        else if authorization == .authorizedWhenInUse { manager.requestAlwaysAuthorization() }
    }

    func requestMotionPermission() throws {
        guard Bundle.main.object(forInfoDictionaryKey: "NSMotionUsageDescription") != nil else {
            throw GuardianCoreError.missingPermissions
        }
        let now = Date()
        if CMMotionActivityManager.isActivityAvailable() {
            activityManager.queryActivityStarting(from: now.addingTimeInterval(-1), to: now, to: .main) { _, _ in }
        } else if CMPedometer.isStepCountingAvailable() {
            pedometer.queryPedometerData(from: now.addingTimeInterval(-1), to: now) { _, _ in }
        } else {
            throw GuardianCoreError.unavailable
        }
    }

    func start(geofences: [GuardianGeofence], noMotionThresholdMinutes: Int) throws {
        guard authorization == .authorizedAlways else { throw GuardianCoreError.missingPermissions }
        guard accuracyAuthorization == .fullAccuracy else { throw GuardianCoreError.missingPreciseLocation }
        guard hasBackgroundMode else { throw GuardianCoreError.missingBackgroundMode }
        guard CLLocationManager.significantLocationChangeMonitoringAvailable(), CLLocationManager.isMonitoringAvailable(for: CLCircularRegion.self) else { throw GuardianCoreError.unavailable }
        guard !geofences.isEmpty else { throw GuardianCoreError.invalidConfiguration }
        try validateSupported(geofences)
        try store.configure(enabled: true, geofences: geofences, noMotionThresholdMinutes: noMotionThresholdMinutes)
        restore()
    }

    func stop() throws {
        stopMonitoring()
        try store.setInactivity(GuardianInactivityState())
        try store.configure(enabled: false, geofences: store.geofences)
    }

    func setGeofences(_ geofences: [GuardianGeofence]) throws {
        try validateSupported(geofences)
        try store.configure(enabled: store.enabled, geofences: geofences)
        geofencesById = Dictionary(uniqueKeysWithValues: geofences.map { ($0.id, $0) })
        if store.enabled { restore() }
    }

    func setNoMotionThresholdMinutes(_ value: Int) throws {
        try store.setNoMotionThresholdMinutes(value)
        evaluateInactivity(at: Date())
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
        homeRegionStates = [:]
        manager.monitoredRegions.forEach { manager.stopMonitoring(for: $0) }
        for fence in store.geofences {
            let region = fence.region()
            manager.startMonitoring(for: region)
            if fence.kind == "home" { manager.requestState(for: region) }
        }
        manager.startMonitoringSignificantLocationChanges()
        isMonitoring = true
        applyTrackingForCurrentPresence()
        manager.requestLocation()
    }

    private func stopMonitoring() {
        stopAwayTracking()
        manager.stopMonitoringSignificantLocationChanges()
        manager.monitoredRegions.forEach { manager.stopMonitoring(for: $0) }
        isMonitoring = false
        previousLocation = nil
        homeRegionStates = [:]
    }

    private func startAwayTracking() {
        guard isMonitoring, !homeGeofences.isEmpty else { return }
        if !isReceivingStandardLocations {
            manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
            manager.distanceFilter = 50
            manager.pausesLocationUpdatesAutomatically = false
            manager.startUpdatingLocation()
            isReceivingStandardLocations = true
        }
        startMotionUpdates()
        if inactivityTimer == nil {
            inactivityTimer = Timer.scheduledTimer(withTimeInterval: 60, repeats: true) { [weak self] _ in
                self?.evaluateInactivity(at: Date())
            }
        }
        evaluateInactivity(at: Date())
    }

    private func stopAwayTracking() {
        inactivityTimer?.invalidate()
        inactivityTimer = nil
        if isReceivingStandardLocations {
            manager.stopUpdatingLocation()
            isReceivingStandardLocations = false
        }
        manager.pausesLocationUpdatesAutomatically = true
        activityManager.stopActivityUpdates()
        pedometer.stopUpdates()
        isReceivingMotion = false
        lastPedometerSteps = nil
    }

    private func startMotionUpdates() {
        guard !isReceivingMotion else { return }
        isReceivingMotion = true
        let now = Date()
        if CMMotionActivityManager.isActivityAvailable() {
            let start = [store.inactivity.awaySince, store.inactivity.lastMovementAt]
                .compactMap { $0 }
                .max()
                .map { max($0, now.addingTimeInterval(-7 * 24 * 60 * 60)) } ?? now
            if start < now {
                activityManager.queryActivityStarting(from: start, to: now, to: .main) { [weak self] activities, _ in
                    activities?.sorted(by: { $0.startDate < $1.startDate }).forEach {
                        self?.handleMotionActivity($0)
                    }
                }
            }
            activityManager.startActivityUpdates(to: .main) { [weak self] activity in
                guard let activity else { return }
                self?.handleMotionActivity(activity)
            }
        }
        if CMPedometer.isStepCountingAvailable() {
            pedometer.startUpdates(from: now) { [weak self] data, _ in
                guard let self, let data else { return }
                DispatchQueue.main.async {
                    let steps = data.numberOfSteps.intValue
                    defer { self.lastPedometerSteps = steps }
                    guard steps > (self.lastPedometerSteps ?? 0) else { return }
                    self.observeMovement(at: data.endDate, source: "motion")
                }
            }
        }
    }

    private func handleMotionActivity(_ activity: CMMotionActivity) {
        guard activity.confidence != .low,
              activity.walking || activity.running || activity.cycling || activity.automotive else { return }
        observeMovement(at: activity.startDate, source: "motion")
    }

    private func applyTrackingForCurrentPresence() {
        if store.inactivity.homePresence == .away { startAwayTracking() }
        else { stopAwayTracking() }
    }

    private func updateHomePresence(outsideHome: Bool, at date: Date) {
        guard !homeGeofences.isEmpty else { return }
        var state = store.inactivity
        state.observeTrustedLocation(outsideHome: outsideHome, at: date)
        guard persist(state) else { return }
        applyTrackingForCurrentPresence()
    }

    @discardableResult
    private func observeMovement(at date: Date, source: String) -> Bool {
        var state = store.inactivity
        let resolvedAlert = state.observeMovement(at: date)
        guard state != store.inactivity else { return false }
        if resolvedAlert {
            let event = GuardianEvent(
                type: .motionDetected,
                title: "重新检测到可信移动",
                description: "长时间无明显移动后，手机重新出现了可信移动迹象。",
                timestamp: date,
                source: source,
                location: previousLocation,
                batteryLevel: UIDevice.current.batteryLevel,
                locationLabel: "家外"
            )
            guard persist(state, with: event) else { return false }
            onEvent?(event)
            return true
        }
        guard persist(state) else { return false }
        return false
    }

    private func evaluateInactivity(at date: Date) {
        guard isMonitoring, !homeGeofences.isEmpty else { return }
        var state = store.inactivity
        guard state.evaluate(at: date, thresholdMinutes: store.noMotionThresholdMinutes) else { return }
        let minutes = store.noMotionThresholdMinutes
        let event = GuardianEvent(
            type: .noMotionForLongTime,
            title: "在家外长时间没有明显移动",
            description: "手机在家以外已连续约\(minutes)分钟没有检测到可信移动，建议家人尽快联系确认。",
            timestamp: date,
            source: "motion",
            location: previousLocation,
            batteryLevel: UIDevice.current.batteryLevel,
            locationLabel: "家外"
        )
        guard persist(state, with: event) else { return }
        onEvent?(event)
    }

    @discardableResult
    private func persist(_ state: GuardianInactivityState) -> Bool {
        do {
            try store.setInactivity(state)
            return true
        } catch {
            onError?(error)
            return false
        }
    }

    private func persist(_ state: GuardianInactivityState, with event: GuardianEvent) -> Bool {
        do {
            try store.append(event, updatingInactivity: state)
            return true
        } catch {
            onError?(error)
            return false
        }
    }

    private func homePosition(for location: CLLocation) -> Bool? {
        let homes = homeGeofences
        guard !homes.isEmpty else { return nil }
        let distances = homes.map { home in
            CLLocation(latitude: home.center.latitude, longitude: home.center.longitude).distance(from: location)
        }
        if zip(homes, distances).contains(where: { home, distance in distance <= home.radiusMeters }) {
            return false
        }
        let uncertainty = max(0, location.horizontalAccuracy)
        if zip(homes, distances).allSatisfy({ home, distance in distance > home.radiusMeters + uncertainty }) {
            return true
        }
        return nil
    }

    private func reconcileRegionStates(at date: Date) {
        let homeIds = Set(homeGeofences.map(\.id))
        guard !homeIds.isEmpty else { return }
        if homeIds.contains(where: { homeRegionStates[$0] == .inside }) {
            updateHomePresence(outsideHome: false, at: date)
        } else if homeIds.allSatisfy({ homeRegionStates[$0] == .outside }) {
            updateHomePresence(outsideHome: true, at: date)
        }
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
        stopAwayTracking()
        onError?(error)
    }

    func locationManager(_ manager: CLLocationManager, didDetermineState state: CLRegionState, for region: CLRegion) {
        guard isMonitoring, geofencesById[region.identifier]?.kind == "home" else { return }
        homeRegionStates[region.identifier] = state
        reconcileRegionStates(at: Date())
    }

    func locationManager(_ manager: CLLocationManager, didEnterRegion region: CLRegion) {
        guard isMonitoring, let fence = geofencesById[region.identifier] else { return }
        if fence.kind == "home" {
            homeRegionStates[fence.id] = .inside
            updateHomePresence(outsideHome: false, at: Date())
        } else {
            observeMovement(at: Date(), source: "geofence")
        }
        let type: GuardianEventType = fence.kind == "home" ? .returnHome : fence.kind == "work" ? .enterWorkArea : .enterWaypoint
        emit(type, fence: fence, title: "进入\(fence.name)")
    }

    func locationManager(_ manager: CLLocationManager, didExitRegion region: CLRegion) {
        guard isMonitoring, let fence = geofencesById[region.identifier] else { return }
        if fence.kind == "home" {
            homeRegionStates[fence.id] = .outside
            reconcileRegionStates(at: Date())
        } else {
            observeMovement(at: Date(), source: "geofence")
        }
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
            if let outsideHome = homePosition(for: location) {
                updateHomePresence(outsideHome: outsideHome, at: location.timestamp)
            }
            let event = GuardianEvent(
                type: moved ? .motionDetected : .locationUpdated,
                title: moved ? "检测到可信移动" : "更新当前位置",
                description: moved ? "新定位显示手机发生了可信移动。" : "收到有效位置，尚不能据此判断移动。",
                timestamp: location.timestamp,
                source: "location",
                location: location,
                batteryLevel: UIDevice.current.batteryLevel
            )
            let emittedRecovery = moved && observeMovement(at: location.timestamp, source: "location")
            if !emittedRecovery { onEvent?(event) }
            evaluateInactivity(at: Date())
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
