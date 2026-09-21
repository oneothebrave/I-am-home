import UIKit

final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?
  private var hasBecomeActive = false

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard
      let windowScene = scene as? UIWindowScene,
      let appDelegate = UIApplication.shared.delegate as? AppDelegate
    else {
      return
    }

    let window = UIWindow(windowScene: windowScene)
    window.backgroundColor = guardianBackgroundColor
    self.window = window
    appDelegate.startReactNative(in: window)
  }

  func sceneDidBecomeActive(_ scene: UIScene) {
    defer { hasBecomeActive = true }
    guard hasBecomeActive else { return }
    GuardianBootstrap.restore(reason: "scene-active")
  }
}
