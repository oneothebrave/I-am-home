import Foundation
import CoreLocation
import CoreMotion
import UserNotifications
import React

@objc(GuardianNative)
final class GuardianNativeModule: RCTEventEmitter {
    private var observing = false
    private var runtime: GuardianRuntime { GuardianRuntime.shared }

    override static func requiresMainQueueSetup() -> Bool { true }
    override func supportedEvents() -> [String] { ["GuardianEvent", "GuardianError"] }

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
        }
    }

    override func stopObserving() {
        DispatchQueue.main.async { [weak self] in self?.observing = false }
    }

    private func perform(_ resolve: @escaping RCTPromiseResolveBlock, _ reject: @escaping RCTPromiseRejectBlock,
                         operation: @escaping (GuardianRuntime) throws -> Any?) {
        DispatchQueue.main.async {
            do { resolve(try operation(self.runtime)) }
            catch { reject("GUARDIAN_ERROR", String(describing: error), error) }
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
                    "pendingEventCount": store.pendingEvents.count, "lastError": runtime.lastError.map { String(describing: $0) } ?? ""] as [String: Any]
        }
    }

    @objc(startGuardian:resolver:rejecter:)
    func startGuardian(config: [String: Any], resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        perform(resolve, reject) { runtime in
            guard let raw = config["geofences"] as? [[String: Any]] else { throw GuardianCoreError.invalidConfiguration }
            try runtime.requireService().start(geofences: raw.map { try GuardianGeofence(dictionary: $0) })
            return nil
        }
    }

    @objc(stopGuardian:rejecter:)
    func stopGuardian(resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        perform(resolve, reject) { runtime in try runtime.requireService().stop(); return nil }
    }

    @objc(setGeofences:resolver:rejecter:)
    func setGeofences(rawGeofences: [[String: Any]], resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        perform(resolve, reject) { runtime in
            try runtime.requireService().setGeofences(rawGeofences.map { try GuardianGeofence(dictionary: $0) })
            return nil
        }
    }

    @objc(confirmSafe:rejecter:)
    func confirmSafe(resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        perform(resolve, reject) { runtime in
            try runtime.record(GuardianEvent(type: .userConfirmedSafe, title: "本人确认平安", description: "本人已明确确认平安。", timestamp: Date(), source: "user"))
            return nil
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
                    let motion: String
                    switch CMPedometer.authorizationStatus() {
                    case .notDetermined: motion = "notDetermined"
                    case .restricted: motion = "restricted"
                    case .denied: motion = "denied"
                    case .authorized: motion = "authorized"
                    @unknown default: motion = "denied"
                    }
                    let notifications = settings.authorizationStatus == .notDetermined ? "notDetermined" : settings.authorizationStatus == .denied ? "denied" : "authorized"
                    resolve(["location": location, "motion": motion, "notifications": notifications])
                } catch { reject("GUARDIAN_ERROR", String(describing: error), error) }
            }
        }
    }
}
