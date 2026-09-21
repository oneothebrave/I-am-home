import UIKit
import React
import React_RCTAppDelegate
import ReactAppDependencyProvider

let guardianBackgroundColor = UIColor(
  red: 247.0 / 255.0,
  green: 244.0 / 255.0,
  blue: 237.0 / 255.0,
  alpha: 1
)

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
  var window: UIWindow?

  var reactNativeDelegate: ReactNativeDelegate?
  var reactNativeFactory: RCTReactNativeFactory?
  private var launchOptions: [UIApplication.LaunchOptionsKey: Any]?

  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    GuardianBootstrap.registerBackgroundTasks()
    GuardianBootstrap.restore(
      reason: launchOptions?[.location] != nil ? "location-event" : "application-launch"
    )
    self.launchOptions = launchOptions

    let delegate = ReactNativeDelegate()
    let factory = RCTReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

    return true
  }

  func application(
    _ application: UIApplication,
    configurationForConnecting connectingSceneSession: UISceneSession,
    options: UIScene.ConnectionOptions
  ) -> UISceneConfiguration {
    let configuration = UISceneConfiguration(
      name: "Default Configuration",
      sessionRole: connectingSceneSession.role
    )
    configuration.delegateClass = SceneDelegate.self
    return configuration
  }

  func applicationProtectedDataDidBecomeAvailable(_ application: UIApplication) {
    GuardianBootstrap.restore(reason: "protected-data-available")
  }

  func startReactNative(in window: UIWindow) {
    guard let factory = reactNativeFactory else {
      assertionFailure("React Native factory was not configured before the scene connected")
      return
    }

    self.window = window
    factory.startReactNative(
      withModuleName: "DaojiaShuoYisheng",
      in: window,
      launchOptions: launchOptions
    )
  }
}

class ReactNativeDelegate: RCTDefaultReactNativeFactoryDelegate {
  override func customize(_ rootView: RCTRootView) {
    rootView.backgroundColor = guardianBackgroundColor

    let loadingView = UIView(frame: UIScreen.main.bounds)
    loadingView.backgroundColor = guardianBackgroundColor
    let title = UILabel()
    title.translatesAutoresizingMaskIntoConstraints = false
    title.text = "到家了么"
    title.textColor = UIColor(red: 31.0 / 255.0, green: 33.0 / 255.0, blue: 29.0 / 255.0, alpha: 1)
    title.font = .systemFont(ofSize: 36, weight: .bold)
    title.textAlignment = .center
    loadingView.addSubview(title)
    NSLayoutConstraint.activate([
      title.centerXAnchor.constraint(equalTo: loadingView.centerXAnchor),
      NSLayoutConstraint(
        item: title,
        attribute: .centerY,
        relatedBy: .equal,
        toItem: loadingView,
        attribute: .bottom,
        multiplier: 1.0 / 3.0,
        constant: 1
      ),
    ])
    rootView.loadingView = loadingView
    rootView.loadingViewFadeDelay = 0
    rootView.loadingViewFadeDuration = 0.15
  }

  override func sourceURL(for bridge: RCTBridge) -> URL? {
    self.bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG && targetEnvironment(simulator)
    RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "index")
#else
    Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}
