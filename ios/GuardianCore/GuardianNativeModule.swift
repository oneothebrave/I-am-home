import Foundation
import CoreLocation
import CoreMotion
import UserNotifications
import UIKit
import React

@objc(GuardianNative)
final class GuardianNativeModule: RCTEventEmitter {
    private var observing = false
    private var runtime: GuardianRuntime { GuardianRuntime.shared }

    override static func requiresMainQueueSetup() -> Bool { true }
    override func supportedEvents() -> [String] {
        ["GuardianEvent", "GuardianError", "GuardianMessagingUpdate"]
    }

    override func startObserving() {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.observing = true
            self.runtime.onEvent = { [weak self] event in
                guard let self, self.observing else { return }
                self.sendEvent(withName: "GuardianEvent", body: event.toDictionary())
            }
            self.runtime.onError = { [weak self] error in
                guard let self, self.observing else { return }
                self.sendEvent(withName: "GuardianError", body: ["message": String(describing: error)])
            }
            self.runtime.onMessagingUpdate = { [weak self] in
                guard let self, self.observing else { return }
                self.sendEvent(withName: "GuardianMessagingUpdate", body: [:])
            }
        }
    }

    override func stopObserving() {
        DispatchQueue.main.async { [weak self] in self?.observing = false }
    }

    private func perform(_ resolve: @escaping RCTPromiseResolveBlock, _ reject: @escaping RCTPromiseRejectBlock,
                         operation: @escaping (GuardianRuntime) throws -> Any?) {
        DispatchQueue.main.async {
            do { resolve(try operation(self.runtime)) }
            catch {
                self.runtime.remember(error)
                reject("GUARDIAN_ERROR", error.localizedDescription, error)
            }
        }
    }

    @objc(getPendingEvents:rejecter:)
    func getPendingEvents(resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        perform(resolve, reject) { runtime in
            try runtime.flush()
            return try runtime.requireStore().pendingEvents.map { $0.toDictionary() }
        }
    }

    @objc(acknowledgeEvents:resolver:rejecter:)
    func acknowledgeEvents(ids: [String], resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        perform(resolve, reject) { runtime in try runtime.requireStore().acknowledge(Set(ids)); return nil }
    }

    @objc(getCurrentStatus:rejecter:)
    func getCurrentStatus(resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        perform(resolve, reject) { runtime in
            let store = try runtime.requireStore()
            return ["isGuardianOn": store.enabled, "isMonitoring": runtime.service?.isMonitoring ?? false,
                    "isInActiveWindow": store.enabled && store.activeWindow?.contains(Date()) == true,
                    "pendingEventCount": store.pendingEvents.count,
                    "lastError": runtime.lastError.map { String(describing: $0) } ?? "",
                    "reliability": runtime.reliabilityDiagnostics] as [String: Any]
        }
    }

    @objc(startGuardian:resolver:rejecter:)
    func startGuardian(config: [String: Any], resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        perform(resolve, reject) { runtime in
            guard let raw = config["geofences"] as? [[String: Any]],
                  let rawContacts = config["contacts"] as? [[String: Any]],
                  let schedule = config["schedule"] as? [String: Any],
                  let threshold = schedule["noMotionThresholdMinutes"] as? NSNumber
            else { throw GuardianCoreError.invalidConfiguration }
            try runtime.requireService().start(
                geofences: raw.map { try GuardianGeofence(dictionary: $0) },
                noMotionThresholdMinutes: threshold.intValue,
                activeWindow: try GuardianActiveWindow(dictionary: schedule),
                notificationContacts: rawContacts.map { try GuardianNotificationContact(dictionary: $0) }
            )
            runtime.clearLastError()
            return nil
        }
    }

    @objc(stopGuardian:rejecter:)
    func stopGuardian(resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        perform(resolve, reject) { runtime in
            try runtime.requireService().stop()
            runtime.clearLastError()
            return nil
        }
    }

    @objc(setGeofences:resolver:rejecter:)
    func setGeofences(rawGeofences: [[String: Any]], resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        perform(resolve, reject) { runtime in
            try runtime.requireService().setGeofences(rawGeofences.map { try GuardianGeofence(dictionary: $0) })
            runtime.clearLastError()
            return nil
        }
    }

    @objc(setNoMotionThresholdMinutes:resolver:rejecter:)
    func setNoMotionThresholdMinutes(value: NSNumber, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        perform(resolve, reject) { runtime in
            try runtime.requireService().setNoMotionThresholdMinutes(value.intValue)
            runtime.clearLastError()
            return nil
        }
    }

    @objc(setActiveWindow:resolver:rejecter:)
    func setActiveWindow(schedule: [String: Any], resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        perform(resolve, reject) { runtime in
            try runtime.requireService().setActiveWindow(try GuardianActiveWindow(dictionary: schedule))
            runtime.clearLastError()
            return nil
        }
    }

    @objc(setNotificationContacts:resolver:rejecter:)
    func setNotificationContacts(rawContacts: [[String: Any]], resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        perform(resolve, reject) { runtime in
            try runtime.requireService().setNotificationContacts(
                rawContacts.map { try GuardianNotificationContact(dictionary: $0) }
            )
            runtime.clearLastError()
            return nil
        }
    }

    @objc(getCriticalMessagingPreparation:rejecter:)
    func getCriticalMessagingPreparation(resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        perform(resolve, reject) { runtime in
            let store = try runtime.requireStore()
            return [
                "apiAvailable": GuardianCriticalMessagingCapability.apiAvailable,
                "buildConfigured": GuardianCriticalMessagingCapability.enabledForBuild,
                "recipients": store.notificationContacts.sorted(by: { $0.priority < $1.priority }).map { $0.toDictionary() },
                "operations": store.criticalMessageOperations.map { $0.toDictionary() }
            ] as [String: Any]
        }
    }

    @objc(getCurrentLocation:rejecter:)
    func getCurrentLocation(resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        DispatchQueue.main.async {
            do {
                try self.runtime.requireService().requestCurrentLocation { result in
                    switch result {
                    case .success(let location):
                        let formatter = ISO8601DateFormatter()
                        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
                        resolve([
                            "latitude": location.coordinate.latitude,
                            "longitude": location.coordinate.longitude,
                            "accuracy": location.horizontalAccuracy,
                            "timestamp": formatter.string(from: location.timestamp)
                        ])
                    case .failure(let error):
                        reject("LOCATION_ERROR", error.localizedDescription, error)
                    }
                }
            } catch {
                reject("LOCATION_ERROR", error.localizedDescription, error)
            }
        }
    }

    @objc(pickTime:title:resolver:rejecter:)
    func pickTime(
        _ initialTime: String,
        title: String,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        DispatchQueue.main.async {
            let parts = initialTime.split(separator: ":", omittingEmptySubsequences: false)
            guard parts.count == 2,
                  let hour = Int(parts[0]),
                  let minute = Int(parts[1]),
                  (0...23).contains(hour),
                  (0...59).contains(minute),
                  let initialDate = Calendar.autoupdatingCurrent.date(
                    bySettingHour: hour,
                    minute: minute,
                    second: 0,
                    of: Date()
                  ),
                  let presenter = self.activeViewController()
            else {
                reject("TIME_PICKER_ERROR", "无法打开时间选择器。", GuardianCoreError.invalidConfiguration)
                return
            }

            let controller = GuardianTimePickerViewController(
                heading: title,
                initialDate: initialDate
            )
            controller.onFinish = { [weak controller] date in
                controller?.dismiss(animated: true) {
                    guard let date else {
                        resolve(nil)
                        return
                    }
                    let components = Calendar.autoupdatingCurrent.dateComponents([.hour, .minute], from: date)
                    guard let hour = components.hour, let minute = components.minute else {
                        reject("TIME_PICKER_ERROR", "无法读取所选时间。", GuardianCoreError.invalidConfiguration)
                        return
                    }
                    resolve(String(format: "%02d:%02d", hour, minute))
                }
            }
            controller.modalPresentationStyle = .pageSheet
            controller.isModalInPresentation = true
            if let sheet = controller.sheetPresentationController {
                sheet.detents = [.medium()]
                sheet.prefersGrabberVisible = true
            }
            presenter.present(controller, animated: true)
        }
    }

    private func activeViewController() -> UIViewController? {
        let scenes = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .filter { $0.activationState == .foregroundActive }
        guard let root = scenes
            .flatMap(\.windows)
            .first(where: \.isKeyWindow)?
            .rootViewController else { return nil }
        var current = root
        while true {
            if let presented = current.presentedViewController {
                current = presented
            } else if let navigation = current as? UINavigationController,
                      let visible = navigation.visibleViewController {
                current = visible
            } else if let tab = current as? UITabBarController,
                      let selected = tab.selectedViewController {
                current = selected
            } else {
                return current
            }
        }
    }

    @objc(sendSOS:rejecter:)
    func sendSOS(resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        perform(resolve, reject) { runtime in
            try runtime.record(GuardianEvent(type: .sosSent, title: "主动求助", description: "已记录求助，请直接联系家人。", timestamp: Date(), source: "user"))
            return nil
        }
    }

    // Request initiation is separate from reading the actual authorization state.
    @objc(requestPermissions:rejecter:)
    func requestPermissions(resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        perform(resolve, reject) { runtime in
            try runtime.requireService().requestPermissions()
            return nil
        }
    }

    @objc(requestMotionPermission:rejecter:)
    func requestMotionPermission(resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        perform(resolve, reject) { runtime in
            try runtime.requireService().requestMotionPermission()
            return nil
        }
    }

    @objc(getPermissions:rejecter:)
    func getPermissions(resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            DispatchQueue.main.async {
                do {
                    let authorization = try self.runtime.requireService().authorization
                    let location: String
                    switch authorization {
                    case .notDetermined: location = "notDetermined"
                    case .restricted: location = "restricted"
                    case .denied: location = "denied"
                    case .authorizedWhenInUse: location = "whenInUse"
                    case .authorizedAlways: location = "always"
                    @unknown default: location = "denied"
                    }
                    let locationAccuracy: String
                    if authorization == .authorizedWhenInUse || authorization == .authorizedAlways {
                        locationAccuracy = self.runtime.service?.accuracyAuthorization == .fullAccuracy ? "full" : "reduced"
                    } else {
                        locationAccuracy = "unknown"
                    }
                    let motion: String
                    switch CMPedometer.authorizationStatus() {
                    case .notDetermined: motion = "notDetermined"
                    case .restricted: motion = "restricted"
                    case .denied: motion = "denied"
                    case .authorized: motion = "authorized"
                    @unknown default: motion = "denied"
                    }
                    let notifications = settings.authorizationStatus == .notDetermined ? "notDetermined" : settings.authorizationStatus == .denied ? "denied" : "authorized"
                    let backgroundRefresh: String
                    switch UIApplication.shared.backgroundRefreshStatus {
                    case .available: backgroundRefresh = "available"
                    case .denied: backgroundRefresh = "denied"
                    case .restricted: backgroundRefresh = "restricted"
                    @unknown default: backgroundRefresh = "restricted"
                    }
                    resolve([
                        "location": location,
                        "locationAccuracy": locationAccuracy,
                        "motion": motion,
                        "notifications": notifications,
                        "backgroundRefresh": backgroundRefresh
                    ])
                } catch { reject("GUARDIAN_ERROR", error.localizedDescription, error) }
            }
        }
    }
}

private final class GuardianTimePickerViewController: UIViewController {
    private let heading: String
    private let initialDate: Date
    private let picker = UIDatePicker()
    var onFinish: ((Date?) -> Void)?

    init(heading: String, initialDate: Date) {
        self.heading = heading
        self.initialDate = initialDate
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemGroupedBackground

        let cancel = UIButton(type: .system)
        cancel.setTitle("取消", for: .normal)
        cancel.titleLabel?.font = .preferredFont(forTextStyle: .body)
        cancel.addTarget(self, action: #selector(cancelSelection), for: .touchUpInside)

        let done = UIButton(type: .system)
        done.setTitle("完成", for: .normal)
        done.titleLabel?.font = .preferredFont(forTextStyle: .headline)
        done.addTarget(self, action: #selector(confirmSelection), for: .touchUpInside)

        let titleLabel = UILabel()
        titleLabel.font = .preferredFont(forTextStyle: .headline)
        titleLabel.text = heading
        titleLabel.textAlignment = .center

        let header = UIStackView(arrangedSubviews: [cancel, titleLabel, done])
        header.alignment = .center
        header.distribution = .equalCentering
        header.translatesAutoresizingMaskIntoConstraints = false

        picker.datePickerMode = .time
        picker.preferredDatePickerStyle = .wheels
        picker.date = initialDate
        picker.translatesAutoresizingMaskIntoConstraints = false

        view.addSubview(header)
        view.addSubview(picker)
        NSLayoutConstraint.activate([
            header.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 8),
            header.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 20),
            header.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -20),
            header.heightAnchor.constraint(greaterThanOrEqualToConstant: 44),
            cancel.widthAnchor.constraint(greaterThanOrEqualToConstant: 60),
            done.widthAnchor.constraint(greaterThanOrEqualToConstant: 60),
            picker.topAnchor.constraint(equalTo: header.bottomAnchor, constant: 4),
            picker.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            picker.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            picker.bottomAnchor.constraint(lessThanOrEqualTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -8),
        ])
    }

    @objc private func cancelSelection() {
        finish(with: nil)
    }

    @objc private func confirmSelection() {
        finish(with: picker.date)
    }

    private func finish(with date: Date?) {
        let completion = onFinish
        onFinish = nil
        completion?(date)
    }
}
