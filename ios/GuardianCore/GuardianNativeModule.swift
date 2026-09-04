import Foundation

@objc(GuardianNative)
final class GuardianNativeModule: RCTEventEmitter {
    private let locationService = GuardianLocationService()

    override init() {
        super.init()
        locationService.onEvent = { [weak self] event in
            self?.sendEvent(withName: "GuardianEvent", body: event.toDictionary())
        }
    }

    override static func requiresMainQueueSetup() -> Bool {
        true
    }

    override func supportedEvents() -> [String] {
        ["GuardianEvent"]
    }

    @objc(requestPermissions:rejecter:)
    func requestPermissions(resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
        locationService.requestPermissions()
        resolve([
            "location": "notDetermined",
            "motion": "notDetermined",
            "notifications": "notDetermined"
        ])
    }

    @objc(startGuardian:resolver:rejecter:)
    func startGuardian(config: [String: Any], resolver resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
        if let rawGeofences = config["geofences"] as? [[String: Any]] {
            let geofences = rawGeofences.compactMap(GuardianGeofence.init(dictionary:))
            locationService.setGeofences(geofences)
        }

        locationService.start()
        resolve(nil)
    }

    @objc(stopGuardian:rejecter:)
    func stopGuardian(resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
        locationService.stop()
        resolve(nil)
    }

    @objc(setGeofences:resolver:rejecter:)
    func setGeofences(rawGeofences: [[String: Any]], resolver resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
        let geofences = rawGeofences.compactMap(GuardianGeofence.init(dictionary:))
        locationService.setGeofences(geofences)
        resolve(nil)
    }

    @objc(confirmSafe:rejecter:)
    func confirmSafe(resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
        let event = GuardianEvent(
            type: .userConfirmedSafe,
            title: "本人确认安全",
            description: "本人点击了我没事。",
            timestamp: Date(),
            source: "user",
            location: nil,
            batteryLevel: nil
        )
        sendEvent(withName: "GuardianEvent", body: event.toDictionary())
        resolve(nil)
    }

    @objc(sendSOS:rejecter:)
    func sendSOS(resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
        let event = GuardianEvent(
            type: .sosSent,
            title: "发起求助",
            description: "本人主动发送求助。",
            timestamp: Date(),
            source: "user",
            location: nil,
            batteryLevel: nil
        )
        sendEvent(withName: "GuardianEvent", body: event.toDictionary())
        resolve(nil)
    }
}
