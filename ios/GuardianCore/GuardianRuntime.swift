import Foundation

// AppDelegate can restore this runtime before the React Native bridge exists.
final class GuardianRuntime {
    static let shared = GuardianRuntime()
    private(set) var store: GuardianEventStore?
    private(set) var service: GuardianLocationService?
    private(set) var lastError: Error?
    private var unsaved: [GuardianEvent] = []
    var onEvent: ((GuardianEvent) -> Void)?
    var onError: ((Error) -> Void)?

    private init() {
        prepare()
    }

    private func prepare() {
        do {
            let store = try GuardianEventStore()
            let service = GuardianLocationService(store: store)
            self.store = store
            self.service = service
            self.lastError = nil
            service.onEvent = { [weak self] event in
                do { try self?.record(event) } catch { self?.report(error) }
            }
            service.onError = { [weak self] error in self?.report(error) }
            service.restore()
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

    private func report(_ error: Error) {
        lastError = error
        onError?(error)
    }
}

@objc(GuardianBootstrap)
final class GuardianBootstrap: NSObject {
    @objc static func restore() {
        precondition(Thread.isMainThread)
        do { try GuardianRuntime.shared.requireService().restore() }
        catch { NSLog("Guardian restore failed: %@", String(describing: error)) }
    }
}
