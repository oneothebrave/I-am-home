import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

guard CommandLine.arguments.count == 2 else {
  fatalError("Usage: swift draw_guardian_shield.swift <output.png>")
}

let size = 240
let colorSpace = CGColorSpaceCreateDeviceRGB()
guard let context = CGContext(
  data: nil,
  width: size,
  height: size,
  bitsPerComponent: 8,
  bytesPerRow: size * 4,
  space: colorSpace,
  bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
) else {
  fatalError("Could not create bitmap context")
}

context.clear(CGRect(x: 0, y: 0, width: size, height: size))
context.translateBy(x: 40, y: 29)
context.scaleBy(x: 4.0 / 3.0, y: 4.0 / 3.0)

let shield = CGMutablePath()
shield.move(to: CGPoint(x: 60, y: 132))
shield.addCurve(
  to: CGPoint(x: 12, y: 114),
  control1: CGPoint(x: 47, y: 121),
  control2: CGPoint(x: 30, y: 116)
)
shield.addLine(to: CGPoint(x: 12, y: 68))
shield.addCurve(
  to: CGPoint(x: 60, y: 4),
  control1: CGPoint(x: 12, y: 38),
  control2: CGPoint(x: 30, y: 17)
)
shield.addCurve(
  to: CGPoint(x: 108, y: 68),
  control1: CGPoint(x: 90, y: 17),
  control2: CGPoint(x: 108, y: 38)
)
shield.addLine(to: CGPoint(x: 108, y: 114))
shield.addCurve(
  to: CGPoint(x: 60, y: 132),
  control1: CGPoint(x: 90, y: 116),
  control2: CGPoint(x: 73, y: 121)
)
shield.closeSubpath()

context.addPath(shield)
context.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
context.fillPath()

guard let image = context.makeImage() else {
  fatalError("Could not create image")
}

let outputURL = URL(fileURLWithPath: CommandLine.arguments[1]) as CFURL
guard let destination = CGImageDestinationCreateWithURL(
  outputURL,
  UTType.png.identifier as CFString,
  1,
  nil
) else {
  fatalError("Could not create PNG destination")
}

CGImageDestinationAddImage(destination, image, nil)
guard CGImageDestinationFinalize(destination) else {
  fatalError("Could not write PNG")
}
