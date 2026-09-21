import Foundation
import BackgroundTasks

private enum GuardianReliabilityDiagnostics {
    private static let wakeAtKey = "GuardianReliability.lastWakeAt"
    private static let wakeReasonKey = "GuardianReliability.lastWakeReason"
    private static let restoreAtKey = "GuardianReliability.lastRestoreAt"
    private static let restoreSucceededKey = "GuardianReliability.lastRestoreSucceeded"
    private static let backgroundAtKey = "GuardianReliability.lastBackgroundCheckAt"
    private static let nextCheckAtKey = "GuardianReliability.nextBackgroundCheckAt"

    static func recordWake(reason: String, at date: Date = Date()) {
        let defaults = UserDefaults.standard
        defaults.set(date, forKey: wakeAtKey)
        defaults.set(reason, forKey: wakeReasonKey)
    }

    static func recordRestore(success: Bool, at date: Date = Date()) {
        let defaults = UserDefaults.standard
        defaults.set(date, forKey: restoreAtKey)
        defaults.set(success, forKey: restoreSucceededKey)
    }

    static func recordBackgroundCheck(at date: Date = Date()) {
        UserDefaults.standard.set(date, forKey: backgroundAtKey)
    }

    static func recordNextCheck(_ date: Date?) {
        let defaults = UserDefaults.standard
        if let date { defaults.set(date, forKey: nextCheckAtKey) }
        else { defaults.removeObject(forKey: nextCheckAtKey) }
    }

    static var dictionary: [String: Any] {
        let defaults = UserDefaults.standard
        var value: [String: Any] = [
            "lastWakeReason": defaults.string(forKey: wakeReasonKey) ?? ""
        ]
        if let date = defaults.object(forKey: wakeAtKey) as? Date {
            value["lastWakeAt"] = date.timeIntervalSince1970 * 1000
        }
        if let date = defaults.object(forKey: restoreAtKey) as? Date {
            value["lastRestoreAt"] = date.timeIntervalSince1970 * 1000
            value["lastRestoreSucceeded"] = defaults.bool(forKey: restoreSucceededKey)
        }
        if let date = defaults.object(forKey: backgroundAtKey) as? Date {
            value["lastBackgroundCheckAt"] = date.timeIntervalSince1970 * 1000
        }
        if let date = defaults.object(forKey: nextCheckAtKey) as? Date {
            value["nextBackgroundCheckAt"] = date.timeIntervalSince1970 * 1000
        }
        return value
    }
}

private final class GuardianBackgroundScheduler {
    enum Source: Hashable {
        case guardian
        case criticalMessaging
    }

    static let shared = GuardianBackgroundScheduler()
    static let identifier = "com.llingrui.iamhome.guardian.refresh"

    private var isRegistered = false
    private var scheduledDate: Date?
    private var requestedDates: [Source: Date] = [:]

    func register() {
        guard !isRegistered else { return }
        isRegistered = BGTaskScheduler.shared.register(
            forTaskWithIdentifier: Self.identifier,
            using: .main
        ) { task in
            guard let refreshTask = task as? BGAppRefreshTask else {
                task.setTaskCompleted(success: false)
                return
            }
            self.scheduledDate = nil
            self.requestedDates = self.requestedDates.filter { $0.value > Date() }
            GuardianReliabilityDiagnostics.recordNextCheck(nil)
            GuardianRuntime.shared.handleBackgroundRefresh(refreshTask)
        }
    }

    func schedule(at requestedDate: Date?, source: Source) {
        precondition(Thread.isMainThread)
        requestedDates[source] = requestedDate
        guard let earliestDate = requestedDates.values.min() else {
            BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: Self.identifier)
            scheduledDate = nil
            GuardianReliabilityDiagnostics.recordNextCheck(nil)
            return
        }
        if let scheduledDate, abs(scheduledDate.timeIntervalSince(earliestDate)) < 1 { return }

        BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: Self.identifier)
        let request = BGAppRefreshTaskRequest(identifier: Self.identifier)
        request.earliestBeginDate = max(earliestDate, Date().addingTimeInterval(5))
        do {
            try BGTaskScheduler.shared.submit(request)
            scheduledDate = request.earliestBeginDate
            GuardianReliabilityDiagnostics.recordNextCheck(request.earliestBeginDate)
        } catch {
            scheduledDate = nil
            GuardianReliabilityDiagnostics.recordNextCheck(nil)
            NSLog("Guardian background check scheduling failed: %@", String(describing: error))
        }
    }
}

// AppDelegate can restore this runtime before the React Native bridge exists.
final class GuardianRuntime {
    static let shared = GuardianRuntime()
    private(set) var store: GuardianEventStore?
    private(set) var service: GuardianLocationService?
    private(set) var messagingCoordinator: GuardianCriticalMessagingCoordinator?
    private(set) var lastError: Error?
    private var unsaved: [GuardianEvent] = []
    var onEvent: ((GuardianEvent) -> Void)?
    var onError: ((Error) -> Void)?
    var onMessagingUpdate: (() -> Void)?

    private init() {
        prepare()
    }

    private func prepare() {
        do {
            let store = try GuardianEventStore()
            let service = GuardianLocationService(store: store)
            let messagingCoordinator = GuardianCriticalMessagingCoordinator(store: store)
            self.store = store
            self.service = service
            self.messagingCoordinator = messagingCoordinator
            self.lastError = nil
            service.onEvent = { [weak self] event in
                do {
                    try self?.record(event)
                    self?.processCriticalMessages(reason: "guardian-event")
                } catch { self?.report(error) }
            }
            service.onError = { [weak self] error in self?.report(error) }
            service.onBackgroundCheckNeeded = { date in
                GuardianBackgroundScheduler.shared.schedule(at: date, source: .guardian)
            }
            messagingCoordinator.onUpdate = { [weak self] in self?.onMessagingUpdate?() }
            messagingCoordinator.onNextActionDate = { date in
                GuardianBackgroundScheduler.shared.schedule(at: date, source: .criticalMessaging)
            }
        } catch { lastError = error }
    }

    func requireStore() throws -> GuardianEventStore {
        if store == nil { prepare() }
        guard let store else { throw lastError ?? GuardianCoreError.unavailable }
        return store
    }

    func requireService() throws -> GuardianLocationService {
        if service == nil { prepare() }
        guard let service else { throw lastError ?? GuardianCoreError.unavailable }
        return service
    }

    func record(_ event: GuardianEvent) throws {
        unsaved.append(event)
        try flush()
    }

    func flush() throws {
        let store = try requireStore()
        while let event = unsaved.first {
            try store.append(event)
            unsaved.removeFirst()
            onEvent?(event)
        }
    }

    func remember(_ error: Error) {
        lastError = error
    }

    func clearLastError() {
        lastError = nil
    }

    var reliabilityDiagnostics: [String: Any] {
        GuardianReliabilityDiagnostics.dictionary
    }

    func restore(reason: String) throws {
        GuardianReliabilityDiagnostics.recordWake(reason: reason)
        let service = try requireService()
        service.restore(forceMotionHistoryReplay: true) { [weak self] success in
            GuardianReliabilityDiagnostics.recordRestore(success: success)
            self?.processCriticalMessages(reason: "restore-\(reason)")
        }
    }

    func processCriticalMessages(reason: String) {
        guard let messagingCoordinator else { return }
        Task { @MainActor in
            await messagingCoordinator.process(reason: reason)
        }
    }

    func requestCriticalMessagingAuthorization() async throws {
        guard let messagingCoordinator else { throw GuardianCoreError.unavailable }
        try await messagingCoordinator.requestAuthorization()
    }

    func refreshCriticalMessagingAuthorization() async throws {
        guard let messagingCoordinator else { throw GuardianCoreError.unavailable }
        try await messagingCoordinator.refreshAuthorization()
    }

    fileprivate func handleBackgroundRefresh(_ task: BGAppRefreshTask) {
        GuardianReliabilityDiagnostics.recordBackgroundCheck()
        var completed = false
        let finish: (Bool) -> Void = { success in
            guard !completed else { return }
            completed = true
            task.setTaskCompleted(success: success)
        }
        task.expirationHandler = {
            DispatchQueue.main.async { finish(false) }
        }
        do {
            try requireService().performReliabilityCheck { success in
                GuardianReliabilityDiagnostics.recordRestore(success: success)
                guard let coordinator = self.messagingCoordinator else {
                    finish(success)
                    return
                }
                Task { @MainActor in
                    await coordinator.process(reason: "background-refresh")
                    finish(success)
                }
            }
        } catch {
            report(error)
            finish(false)
        }
    }

    private func report(_ error: Error) {
        lastError = error
        onError?(error)
    }
}

@objc(GuardianBootstrap)
final class GuardianBootstrap: NSObject {
    @objc static func registerBackgroundTasks() {
        precondition(Thread.isMainThread)
        GuardianBackgroundScheduler.shared.register()
    }

    @objc static func restore(reason: String) {
        precondition(Thread.isMainThread)
        do { try GuardianRuntime.shared.restore(reason: reason) }
        catch { NSLog("Guardian restore failed: %@", String(describing: error)) }
    }
}
