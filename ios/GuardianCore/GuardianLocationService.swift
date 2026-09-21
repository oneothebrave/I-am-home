import CoreLocation
import CoreMotion
import UIKit

private enum GuardianActivityEvidence {
    case coreMotion(String)
    case pedometer(Int)
    case location(distanceMeters: Double, requiredMeters: Double)
    case visit

    var source: String {
        switch self {
        case .coreMotion: return "coreMotion"
        case .pedometer: return "pedometer"
        case .location: return "location"
        case .visit: return "visit"
        }
    }

    var title: String {
        switch self {
        case .coreMotion(let kind): return "检测到\(kind)活动"
        case .pedometer: return "检测到连续步数"
        case .location: return "检测到可信位置移动"
        case .visit: return "检测到地点停留变化"
        }
    }

    var detail: String {
        switch self {
        case .coreMotion(let kind):
            return "运动与健身识别到\(kind)，已重新计算停留时间。"
        case .pedometer(let steps):
            return "计步器累计新增 \(steps) 步，已重新计算停留时间。"
        case .location(let distance, let required):
            return "定位确认移动约 \(Int(distance.rounded())) 米，超过当前精度所需的 \(Int(required.rounded())) 米。"
        case .visit:
            return "系统记录到一次地点离开，已重新计算停留时间。"
        }
    }
}

final class GuardianLocationService: NSObject, CLLocationManagerDelegate {
    private typealias LocationRequest = (Result<CLLocation, Error>) -> Void
    private let manager = CLLocationManager()
    private let activityManager = CMMotionActivityManager()
    private let pedometer = CMPedometer()
    private let store: GuardianEventStore
    private var geofencesById: [String: GuardianGeofence] = [:]
    private var homeRegionStates: [String: CLRegionState] = [:]
    private var previousLocation: CLLocation?
    // Keep a stationary anchor: successive small steps must accumulate into displacement.
    private var movementAnchor: CLLocation?
    private var locationRequest: LocationRequest?
    private var locationRequestTimeout: DispatchWorkItem?
    private var oneShotLocationPending = false
    private var oneShotLocationObservers: [(Bool) -> Void] = []
    private var inactivityTimer: Timer?
    private var activeWindowBoundaryTimer: Timer?
    private var monitoringRetry: DispatchWorkItem?
    private var lastAcceptedPedometerSteps = 0
    private var lastActivityRecordAt: Date?
    private var isRestoringMotionHistory = false
    private var restorationInProgress = false
    private var restorationLocationPending = false
    private var restorationSucceeded = true
    private var restorationObservers: [(Bool) -> Void] = []
    private var restorationBackgroundTask: UIBackgroundTaskIdentifier = .invalid
    private var isReceivingStandardLocations = false
    private var isReceivingMotion = false
    private(set) var isMonitoring = false
    var onEvent: ((GuardianEvent) -> Void)?
    var onError: ((Error) -> Void)?
    var onBackgroundCheckNeeded: ((Date?) -> Void)?
    var onShortcutNotificationRequested: ((GuardianCriticalMessageOperation) -> Void)?
    var authorization: CLAuthorizationStatus { manager.authorizationStatus }
    var accuracyAuthorization: CLAccuracyAuthorization { manager.accuracyAuthorization }

    init(store: GuardianEventStore) {
        self.store = store
        super.init()
        movementAnchor = store.movementAnchor?.location
        geofencesById = Dictionary(uniqueKeysWithValues: store.geofences.map { ($0.id, $0) })
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
        manager.distanceFilter = 50
        manager.pausesLocationUpdatesAutomatically = true
        manager.allowsBackgroundLocationUpdates = hasBackgroundMode
        manager.showsBackgroundLocationIndicator = false
        if let cachedLocation = manager.location,
           GuardianLocationPolicy.accepts(cachedLocation) {
            previousLocation = cachedLocation
        }
        UIDevice.current.isBatteryMonitoringEnabled = true
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleSignificantTimeChange),
            name: UIApplication.significantTimeChangeNotification,
            object: nil
        )
    }

    deinit {
        monitoringRetry?.cancel()
        NotificationCenter.default.removeObserver(self)
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

    func start(
        geofences: [GuardianGeofence],
        noMotionThresholdMinutes: Int,
        activeWindow: GuardianActiveWindow,
        notificationContacts: [GuardianNotificationContact]
    ) throws {
        guard authorization == .authorizedAlways else { throw GuardianCoreError.missingPermissions }
        guard accuracyAuthorization == .fullAccuracy else { throw GuardianCoreError.missingPreciseLocation }
        guard hasBackgroundMode else { throw GuardianCoreError.missingBackgroundMode }
        guard CLLocationManager.significantLocationChangeMonitoringAvailable(), CLLocationManager.isMonitoringAvailable(for: CLCircularRegion.self) else { throw GuardianCoreError.unavailable }
        guard !geofences.isEmpty else { throw GuardianCoreError.invalidConfiguration }
        try validateSupported(geofences)
        try store.configure(
            enabled: true,
            geofences: geofences,
            noMotionThresholdMinutes: noMotionThresholdMinutes,
            activeWindow: activeWindow,
            notificationContacts: notificationContacts
        )
        restore()
    }

    func stop() throws {
        stopMonitoring()
        try store.setMovementAnchor(nil)
        try store.setInactivity(GuardianInactivityState())
        try store.configure(enabled: false, geofences: store.geofences)
        scheduleBackgroundCheck(after: Date())
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
        scheduleBackgroundCheck(after: Date())
    }

    func setActiveWindow(_ value: GuardianActiveWindow) throws {
        let changed = try store.setActiveWindow(value)
        guard store.enabled else { return }
        synchronizeActiveWindow(at: Date(), resetActivePeriod: changed)
        scheduleBackgroundCheck(after: Date())
    }

    func setNotificationContacts(_ contacts: [GuardianNotificationContact]) throws {
        try store.setNotificationContacts(contacts)
    }

    func requestCurrentLocation(completion: @escaping (Result<CLLocation, Error>) -> Void) throws {
        guard CLLocationManager.locationServicesEnabled() else { throw GuardianCoreError.unavailable }
        guard authorization == .authorizedWhenInUse || authorization == .authorizedAlways else {
            throw GuardianCoreError.missingPermissions
        }
        guard accuracyAuthorization == .fullAccuracy else { throw GuardianCoreError.missingPreciseLocation }
        guard locationRequest == nil else { throw GuardianCoreError.locationRequestInProgress }

        locationRequest = completion
        beginOneShotLocation(highAccuracy: true)
    }

    private func validateSupported(_ fences: [GuardianGeofence]) throws {
        try GuardianGeofence.validate(fences)
        guard fences.allSatisfy({ $0.radiusMeters <= manager.maximumRegionMonitoringDistance }) else { throw GuardianCoreError.invalidConfiguration }
    }

    func restore(
        forceMotionHistoryReplay: Bool = false,
        completion: ((Bool) -> Void)? = nil
    ) {
        if let completion { restorationObservers.append(completion) }
        guard store.enabled, authorization == .authorizedAlways,
              accuracyAuthorization == .fullAccuracy, hasBackgroundMode else {
            restorationSucceeded = false
            stopMonitoring()
            finishRestoration(success: false)
            return
        }

        geofencesById = Dictionary(uniqueKeysWithValues: store.geofences.map { ($0.id, $0) })
        reconcileMonitoredRegions()
        manager.startMonitoringSignificantLocationChanges()
        manager.startMonitoringVisits()
        isMonitoring = true

        if restorationInProgress {
            if forceMotionHistoryReplay, store.inactivity.homePresence == .away {
                startMotionUpdates(forceHistoryReplay: true)
            }
            scheduleBackgroundCheck(after: Date())
            return
        }

        restorationInProgress = true
        restorationSucceeded = true
        restorationLocationPending = true
        beginRestorationBackgroundTaskIfNeeded()
        synchronizeActiveWindow(at: Date())
        if forceMotionHistoryReplay, store.inactivity.homePresence == .away {
            startMotionUpdates(forceHistoryReplay: true)
        }
        beginOneShotLocation(highAccuracy: false) { [weak self] success in
            guard let self else { return }
            self.restorationLocationPending = false
            self.restorationSucceeded = self.restorationSucceeded && success
            self.finishRestorationIfReady()
        }
        finishRestorationIfReady()
    }

    func performReliabilityCheck(completion: @escaping (Bool) -> Void) {
        restore(forceMotionHistoryReplay: true, completion: completion)
    }

    private func reconcileMonitoredRegions() {
        let desired = Dictionary(uniqueKeysWithValues: store.geofences.map { ($0.id, $0) })
        let existing = manager.monitoredRegions.compactMap { $0 as? CLCircularRegion }
        var reusableIds = Set<String>()

        for region in existing {
            if let fence = desired[region.identifier], fence.matches(region) {
                reusableIds.insert(region.identifier)
            } else {
                manager.stopMonitoring(for: region)
            }
        }
        for fence in store.geofences where !reusableIds.contains(fence.id) {
            manager.startMonitoring(for: fence.region())
        }

        let homeIds = Set(homeGeofences.map(\.id))
        homeRegionStates = homeRegionStates.filter { homeIds.contains($0.key) }
        for region in manager.monitoredRegions {
            if homeIds.contains(region.identifier) { manager.requestState(for: region) }
        }
        for fence in homeGeofences where !manager.monitoredRegions.contains(where: { $0.identifier == fence.id }) {
            manager.requestState(for: fence.region())
        }
    }

    private func stopMonitoring() {
        monitoringRetry?.cancel()
        monitoringRetry = nil
        activeWindowBoundaryTimer?.invalidate()
        activeWindowBoundaryTimer = nil
        if oneShotLocationPending {
            finishOneShotLocation(.failure(GuardianCoreError.unavailable))
        }
        stopAwayTracking()
        manager.stopMonitoringSignificantLocationChanges()
        manager.stopMonitoringVisits()
        manager.monitoredRegions.forEach { manager.stopMonitoring(for: $0) }
        isMonitoring = false
        previousLocation = nil
        movementAnchor = nil
        homeRegionStates = [:]
        onBackgroundCheckNeeded?(nil)
    }

    private func startAwayTracking() {
        guard isMonitoring, !homeGeofences.isEmpty, isWithinActiveWindow(at: Date()) else { return }
        if !isReceivingStandardLocations {
            manager.desiredAccuracy = kCLLocationAccuracyBest
            manager.distanceFilter = 10
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
        if isRestoringMotionHistory {
            isRestoringMotionHistory = false
            finishMotionHistory(success: false)
        }
        lastAcceptedPedometerSteps = 0
    }

    private func startMotionUpdates(forceHistoryReplay: Bool = false) {
        let shouldStartLiveUpdates = !isReceivingMotion
        if shouldStartLiveUpdates {
            isReceivingMotion = true
            if CMMotionActivityManager.isActivityAvailable() {
                activityManager.startActivityUpdates(to: .main) { [weak self] activity in
                    guard let activity else { return }
                    self?.handleMotionActivity(activity)
                }
            }
            if CMPedometer.isStepCountingAvailable() {
                lastAcceptedPedometerSteps = 0
                pedometer.startUpdates(from: Date()) { [weak self] data, _ in
                    guard let self, let data else { return }
                    DispatchQueue.main.async {
                        let steps = data.numberOfSteps.intValue
                        guard GuardianLocationPolicy.indicatesPedometerMovement(
                            totalSteps: steps,
                            lastAcceptedSteps: self.lastAcceptedPedometerSteps
                        ) else { return }
                        let delta = steps - self.lastAcceptedPedometerSteps
                        self.lastAcceptedPedometerSteps = steps
                        self.observeMovement(at: data.endDate, evidence: .pedometer(delta))
                    }
                }
            }
        }
        guard shouldStartLiveUpdates || forceHistoryReplay else { return }
        replayMotionHistory()
    }

    private func replayMotionHistory() {
        guard !isRestoringMotionHistory else { return }
        let now = Date()
        guard CMMotionActivityManager.isActivityAvailable() else {
            finishMotionHistory(success: true)
            return
        }
        let start = [store.inactivity.awaySince, store.inactivity.lastMovementAt]
            .compactMap { $0 }
            .max()
            .map { max($0, now.addingTimeInterval(-7 * 24 * 60 * 60)) } ?? now
        guard start < now else {
            finishMotionHistory(success: true)
            return
        }
        isRestoringMotionHistory = true
        activityManager.queryActivityStarting(from: start, to: now, to: .main) { [weak self] activities, error in
            guard let self else { return }
            guard self.isReceivingMotion else {
                self.isRestoringMotionHistory = false
                self.finishMotionHistory(success: false)
                return
            }
            activities?.sorted(by: { $0.startDate < $1.startDate }).forEach {
                self.handleMotionActivity($0)
            }
            self.isRestoringMotionHistory = false
            self.finishMotionHistory(success: error == nil)
        }
    }

    private func handleMotionActivity(_ activity: CMMotionActivity) {
        guard activity.confidence != .low,
              activity.walking || activity.running || activity.cycling || activity.automotive else { return }
        let kind = activity.walking ? "步行" : activity.running ? "跑步" :
            activity.cycling ? "骑行" : "乘车"
        observeMovement(at: activity.startDate, evidence: .coreMotion(kind))
    }

    private func isWithinActiveWindow(at date: Date) -> Bool {
        store.activeWindow?.contains(date) == true
    }

    private func synchronizeActiveWindow(at date: Date, resetActivePeriod: Bool = false) {
        scheduleNextActiveWindowBoundary(after: date)
        guard isMonitoring, let activeWindow = store.activeWindow,
              activeWindow.contains(date),
              let periodStart = activeWindow.periodStart(containing: date)
        else {
            var state = store.inactivity
            state.suspendAwayTracking()
            if state != store.inactivity { _ = persist(state) }
            stopAwayTracking()
            scheduleBackgroundCheck(after: date)
            return
        }

        var state = store.inactivity
        if resetActivePeriod { state.suspendAwayTracking() }
        state.resumeAwayTracking(noEarlierThan: resetActivePeriod ? date : periodStart)
        if state != store.inactivity, !persist(state) { return }
        if state.homePresence == .away { startAwayTracking() }
        else { stopAwayTracking() }
        scheduleBackgroundCheck(after: date)
    }

    private func scheduleNextActiveWindowBoundary(after date: Date) {
        activeWindowBoundaryTimer?.invalidate()
        activeWindowBoundaryTimer = nil
        guard isMonitoring, let boundary = store.activeWindow?.nextBoundary(after: date) else { return }
        let timer = Timer(fire: boundary, interval: 0, repeats: false) { [weak self] _ in
            self?.synchronizeActiveWindow(at: Date())
        }
        RunLoop.main.add(timer, forMode: .common)
        activeWindowBoundaryTimer = timer
    }

    private func scheduleBackgroundCheck(after date: Date) {
        guard store.enabled, isMonitoring, let activeWindow = store.activeWindow else {
            onBackgroundCheckNeeded?(nil)
            return
        }
        let boundary = activeWindow.nextBoundary(after: date)
        guard activeWindow.contains(date) else {
            onBackgroundCheckNeeded?(boundary)
            return
        }
        let inactivityDue = store.inactivity.nextEvaluationDate(
            thresholdMinutes: store.noMotionThresholdMinutes
        )
        onBackgroundCheckNeeded?([boundary, inactivityDue].compactMap { $0 }.min())
    }

    private func beginOneShotLocation(
        highAccuracy: Bool,
        observer: ((Bool) -> Void)? = nil
    ) {
        if let observer { oneShotLocationObservers.append(observer) }
        if highAccuracy { manager.desiredAccuracy = kCLLocationAccuracyBest }
        guard !oneShotLocationPending else { return }

        oneShotLocationPending = true
        let timeout = DispatchWorkItem { [weak self] in
            self?.finishOneShotLocation(.failure(GuardianCoreError.locationTimedOut))
        }
        locationRequestTimeout = timeout
        DispatchQueue.main.asyncAfter(deadline: .now() + 15, execute: timeout)
        manager.requestLocation()
    }

    private func finishOneShotLocation(_ result: Result<CLLocation, Error>) {
        guard oneShotLocationPending else { return }
        oneShotLocationPending = false
        locationRequestTimeout?.cancel()
        locationRequestTimeout = nil
        manager.desiredAccuracy = isReceivingStandardLocations ? kCLLocationAccuracyBest : kCLLocationAccuracyHundredMeters

        let request = locationRequest
        locationRequest = nil
        let observers = oneShotLocationObservers
        oneShotLocationObservers = []
        request?(result)
        let success = (try? result.get()) != nil
        observers.forEach { $0(success) }
    }

    private func finishMotionHistory(success: Bool) {
        if restorationInProgress { restorationSucceeded = restorationSucceeded && success }
        finishRestorationIfReady()
    }

    private func finishRestorationIfReady() {
        guard restorationInProgress, !restorationLocationPending, !isRestoringMotionHistory else {
            return
        }
        evaluateInactivity(at: Date())
        scheduleBackgroundCheck(after: Date())
        finishRestoration(success: restorationSucceeded)
    }

    private func finishRestoration(success: Bool) {
        restorationInProgress = false
        restorationLocationPending = false
        endRestorationBackgroundTask()
        let observers = restorationObservers
        restorationObservers = []
        observers.forEach { $0(success) }
    }

    private func beginRestorationBackgroundTaskIfNeeded() {
        guard restorationBackgroundTask == .invalid,
              UIApplication.shared.applicationState == .background else { return }
        restorationBackgroundTask = UIApplication.shared.beginBackgroundTask(
            withName: "Restore on-device guardian"
        ) { [weak self] in
            DispatchQueue.main.async {
                self?.endRestorationBackgroundTask()
            }
        }
    }

    private func endRestorationBackgroundTask() {
        guard restorationBackgroundTask != .invalid else { return }
        let identifier = restorationBackgroundTask
        restorationBackgroundTask = .invalid
        UIApplication.shared.endBackgroundTask(identifier)
    }

    private func updateHomePresence(outsideHome: Bool, at date: Date) {
        guard !homeGeofences.isEmpty else { return }
        guard store.inactivity.lastTrustedLocationAt.map({ date >= $0 }) ?? true else { return }
        var state = store.inactivity
        let returnedHome = !outsideHome && state.homePresence == .away
        state.observeTrustedLocation(outsideHome: outsideHome, at: date)
        guard persist(state) else { return }
        if returnedHome {
            let event = GuardianEvent(type: .returnHome, title: "回到家中", description: "定位已确认回到家的守护范围。",
                timestamp: date, source: "location", location: previousLocation,
                locationLabel: "家中")
            onEvent?(event)
        }
        synchronizeActiveWindow(at: Date())
        scheduleBackgroundCheck(after: Date())
    }

    @discardableResult
    private func observeMovement(
        at date: Date,
        evidence: GuardianActivityEvidence,
        location: CLLocation? = nil
    ) -> Bool {
        guard isWithinActiveWindow(at: Date()) else {
            synchronizeActiveWindow(at: Date())
            return false
        }
        var state = store.inactivity
        if state.alertEmittedAt == nil { state.alertEmittedAt = store.activeInactivityIncidentAt }
        let resolvedAlert = state.observeMovement(at: date)
        guard state != store.inactivity else { return false }
        if evidence.source != "location", let previousLocation,
           GuardianLocationPolicy.accepts(previousLocation) {
            movementAnchor = previousLocation
            do { try store.setMovementAnchor(GuardianMovementAnchor(previousLocation)) }
            catch { onError?(error) }
        }
        let shouldRecord = resolvedAlert || (!isRestoringMotionHistory &&
            (lastActivityRecordAt.map { date.timeIntervalSince($0) >= 5 * 60 } ?? true))
        if shouldRecord {
            let event = GuardianEvent(
                type: .motionDetected,
                title: resolvedAlert ? "重新检测到活动" : evidence.title,
                description: evidence.detail,
                timestamp: date,
                source: evidence.source,
                location: location,
                batteryLevel: UIDevice.current.batteryLevel,
                locationLabel: "家外"
            )
            guard persist(state, with: event) else { return false }
            lastActivityRecordAt = date
            onEvent?(event)
            scheduleBackgroundCheck(after: Date())
            return resolvedAlert
        }
        guard persist(state) else { return false }
        scheduleBackgroundCheck(after: Date())
        return false
    }

    private func evaluateInactivity(at date: Date) {
        guard isMonitoring, !homeGeofences.isEmpty else { return }
        guard isWithinActiveWindow(at: date) else {
            synchronizeActiveWindow(at: date)
            return
        }
        guard !isRestoringMotionHistory, !restorationLocationPending else { return }
        guard !store.hasUnresolvedInactivityIncident else { return }
        var state = store.inactivity
        guard state.evaluate(at: date, thresholdMinutes: store.noMotionThresholdMinutes) else { return }
        let minutes = store.noMotionThresholdMinutes
        let riskLocation = recentTrustedLocation(at: date)
        let riskPlace = riskLocation.flatMap { guardianPlaceName(for: $0) } ?? "守护地点外"
        let event = GuardianEvent(
            type: .noMotionForLongTime,
            title: "在家外长时间没有明显移动",
            description: "手机在家以外已连续约\(minutes)分钟没有检测到明显活动，建议家人尽快联系确认。",
            timestamp: date,
            source: "motion",
            location: riskLocation,
            batteryLevel: UIDevice.current.batteryLevel,
            locationLabel: riskPlace
        )
        var criticalMessages = GuardianCriticalMessageOperation.prepare(
            for: event,
            contacts: store.notificationContacts,
            thresholdMinutes: minutes
        )
        // A foreground restoration must not unexpectedly send an overdue background alert.
        if restorationInProgress && UIApplication.shared.applicationState != .background {
            for index in criticalMessages.indices {
                criticalMessages[index].shortcutAttemptPending = false
                criticalMessages[index].shortcutAttemptError = "恢复守护时发现停留超时，已准备短信；未在打开 App 时自动补发。"
            }
        }
        for index in criticalMessages.indices {
            criticalMessages[index].detectionContext = UIApplication.shared.applicationState == .background ? "background" :
                (restorationInProgress ? "restoration" : "foreground")
        }
        guard persist(state, with: event, criticalMessages: criticalMessages) else { return }
        onEvent?(event)
        if let firstShortcutOperation = criticalMessages.first(where: {
            $0.shortcutAttemptPending == true
        }) {
            onShortcutNotificationRequested?(firstShortcutOperation)
        }
        scheduleBackgroundCheck(after: date)
    }

    private func recentTrustedLocation(at date: Date) -> CLLocation? {
        guard let location = previousLocation,
              abs(date.timeIntervalSince(location.timestamp)) <= 15 * 60,
              location.horizontalAccuracy.isFinite,
              (0...100).contains(location.horizontalAccuracy) else { return nil }
        return location
    }

    private func guardianPlaceName(for location: CLLocation) -> String? {
        store.geofences
            .filter { $0.kind != "home" }
            .map { fence in
                (fence, CLLocation(latitude: fence.center.latitude, longitude: fence.center.longitude)
                    .distance(from: location))
            }
            .filter { fence, distance in
                distance <= fence.radiusMeters + max(0, location.horizontalAccuracy)
            }
            .min(by: { $0.1 < $1.1 })?
            .0.name
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

    private func persist(
        _ state: GuardianInactivityState,
        with event: GuardianEvent,
        criticalMessages: [GuardianCriticalMessageOperation] = []
    ) -> Bool {
        do {
            try store.append(event, updatingInactivity: state, criticalMessages: criticalMessages)
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
        if zip(homes, distances).contains(where: { home, distance in distance + max(0, location.horizontalAccuracy) <= home.radiusMeters }) {
            return false
        }
        let uncertainty = max(0, location.horizontalAccuracy)
        if zip(homes, distances).allSatisfy({ home, distance in distance > home.radiusMeters + uncertainty }) {
            return true
        }
        return nil
    }

    private func reconcileRegionStates(at date: Date) {
        // Fresh GPS wins over delayed/cached region state replies during restoration.
        if let location = previousLocation, GuardianLocationPolicy.accepts(location),
           let outside = homePosition(for: location) {
            updateHomePresence(outsideHome: outside, at: location.timestamp)
            return
        }
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
            finishOneShotLocation(.failure(GuardianCoreError.missingPermissions))
        }
        restore()
    }

    @objc private func handleSignificantTimeChange() {
        guard Thread.isMainThread else {
            DispatchQueue.main.async { [weak self] in self?.handleSignificantTimeChange() }
            return
        }
        restore(forceMotionHistoryReplay: true)
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        let wasExplicitRequest = locationRequest != nil
        if oneShotLocationPending { finishOneShotLocation(.failure(error)) }
        if wasExplicitRequest { return }
        onError?(error)
    }

    func locationManager(_ manager: CLLocationManager, monitoringDidFailFor region: CLRegion?, withError error: Error) {
        onError?(error)
        monitoringRetry?.cancel()
        let retry = DispatchWorkItem { [weak self] in self?.restore(forceMotionHistoryReplay: true) }
        monitoringRetry = retry
        DispatchQueue.main.asyncAfter(deadline: .now() + 30, execute: retry)
        onBackgroundCheckNeeded?(Date().addingTimeInterval(5 * 60))
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
        }
        let type: GuardianEventType = fence.kind == "home" ? .returnHome : fence.kind == "work" ? .enterWorkArea : .enterWaypoint
        emit(type, fence: fence, title: "进入\(fence.name)")
    }

    func locationManager(_ manager: CLLocationManager, didExitRegion region: CLRegion) {
        guard isMonitoring, let fence = geofencesById[region.identifier] else { return }
        if fence.kind == "home" {
            homeRegionStates[fence.id] = .outside
            reconcileRegionStates(at: Date())
        }
        let type: GuardianEventType = fence.kind == "home" ? .leaveHome : fence.kind == "work" ? .exitWorkArea : .exitWaypoint
        emit(type, fence: fence, title: "离开\(fence.name)")
    }

    func locationManager(_ manager: CLLocationManager, didVisit visit: CLVisit) {
        guard isMonitoring else {
            restore(forceMotionHistoryReplay: true)
            return
        }
        // An arrival describes a stationary visit, not new movement at delivery time.
        let date = visit.departureDate
        if date != .distantFuture && date <= Date() {
            _ = observeMovement(at: date, evidence: .visit)
        }
        restore(forceMotionHistoryReplay: true)
    }

    func locationManagerDidPauseLocationUpdates(_ manager: CLLocationManager) {
        guard isMonitoring, store.inactivity.homePresence == .away,
              isWithinActiveWindow(at: Date()) else { return }
        isReceivingStandardLocations = false
        startAwayTracking()
    }

    func locationManagerDidResumeLocationUpdates(_ manager: CLLocationManager) {
        isReceivingStandardLocations = true
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        let accepted = locations.filter { GuardianLocationPolicy.accepts($0) }
        if isMonitoring {
            for location in accepted.sorted(by: { $0.timestamp < $1.timestamp }) {
                guard previousLocation.map({ location.timestamp > $0.timestamp }) ?? true else { continue }
                let assessment = GuardianLocationPolicy.movementAssessment(
                    from: movementAnchor,
                    to: location
                )
                let moved = assessment?.indicatesMovement == true
                if movementAnchor == nil || moved ||
                    (movementAnchor!.horizontalAccuracy > 25 && location.horizontalAccuracy <= 15) {
                    movementAnchor = location
                    do { try store.setMovementAnchor(GuardianMovementAnchor(location)) }
                    catch { onError?(error) }
                }
                previousLocation = location
                if let outsideHome = homePosition(for: location) {
                    updateHomePresence(outsideHome: outsideHome, at: location.timestamp)
                }
                if let assessment, assessment.indicatesMovement {
                    _ = observeMovement(
                        at: location.timestamp,
                        evidence: .location(
                            distanceMeters: assessment.distanceMeters,
                            requiredMeters: assessment.requiredDistanceMeters
                        ),
                        location: location
                    )
                }
                let event = GuardianEvent(
                    type: .locationUpdated,
                    title: "更新当前位置",
                    description: "收到有效位置，地点判断已更新。",
                    timestamp: location.timestamp,
                    source: "location",
                    location: location,
                    batteryLevel: UIDevice.current.batteryLevel
                )
                onEvent?(event)
                evaluateInactivity(at: Date())
            }
        }
        if oneShotLocationPending {
            let best = accepted.sorted {
                $0.horizontalAccuracy == $1.horizontalAccuracy
                    ? $0.timestamp > $1.timestamp
                    : $0.horizontalAccuracy < $1.horizontalAccuracy
            }.first
            finishOneShotLocation(
                best.map { .success($0) }
                    ?? .failure(GuardianCoreError.invalidLocationSample)
            )
        }
    }

    private func emit(_ type: GuardianEventType, fence: GuardianGeofence, title: String) {
        // A boundary event identifies a region, not an exact GPS fix at its center.
        onEvent?(GuardianEvent(type: type, title: title, description: "\(title)的守护范围。", timestamp: Date(), source: "geofence",
            batteryLevel: UIDevice.current.batteryLevel, geofenceId: fence.id, locationLabel: "\(fence.name)附近"))
    }

}
