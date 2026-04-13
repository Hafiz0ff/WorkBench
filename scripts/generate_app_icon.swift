#!/usr/bin/env swift

import AppKit
import Foundation

struct IconSpec {
    let size: Int
    let suffix: String
}

func renderIcon(size: Int) -> NSImage {
    let image = NSImage(size: NSSize(width: size, height: size))
    image.lockFocus()
    defer { image.unlockFocus() }

    guard let context = NSGraphicsContext.current else { return image }
    context.shouldAntialias = true
    context.imageInterpolation = .high

    let bounds = NSRect(x: 0, y: 0, width: size, height: size)
    let radius = CGFloat(size) * 0.22
    let background = NSBezierPath(roundedRect: bounds.insetBy(dx: CGFloat(size) * 0.05, dy: CGFloat(size) * 0.05), xRadius: radius, yRadius: radius)
    let startColor = NSColor(calibratedRed: 0.09, green: 0.12, blue: 0.18, alpha: 1.0)
    let endColor = NSColor(calibratedRed: 0.07, green: 0.42, blue: 0.41, alpha: 1.0)
    let gradient = NSGradient(starting: startColor, ending: endColor) ?? NSGradient(colors: [startColor, endColor])!
    gradient.draw(in: background, angle: 135)

    let inner = NSBezierPath(roundedRect: bounds.insetBy(dx: CGFloat(size) * 0.13, dy: CGFloat(size) * 0.13), xRadius: radius * 0.7, yRadius: radius * 0.7)
    NSColor(calibratedWhite: 1.0, alpha: 0.05).setStroke()
    inner.lineWidth = max(1, CGFloat(size) * 0.015)
    inner.stroke()

    let documentRect = NSRect(x: bounds.midX - CGFloat(size) * 0.20, y: bounds.midY - CGFloat(size) * 0.26, width: CGFloat(size) * 0.40, height: CGFloat(size) * 0.50)
    let document = NSBezierPath(roundedRect: documentRect, xRadius: CGFloat(size) * 0.04, yRadius: CGFloat(size) * 0.04)
    NSColor.white.withAlphaComponent(0.95).setFill()
    document.fill()

    let cornerFold = NSBezierPath()
    cornerFold.move(to: NSPoint(x: documentRect.maxX - CGFloat(size) * 0.11, y: documentRect.maxY))
    cornerFold.line(to: NSPoint(x: documentRect.maxX, y: documentRect.maxY - CGFloat(size) * 0.11))
    cornerFold.line(to: NSPoint(x: documentRect.maxX, y: documentRect.maxY))
    cornerFold.close()
    NSColor(calibratedRed: 0.82, green: 0.93, blue: 0.92, alpha: 1.0).setFill()
    cornerFold.fill()

    let codeText = "</>"
    let paragraph = NSMutableParagraphStyle()
    paragraph.alignment = .center
    let attributes: [NSAttributedString.Key: Any] = [
        .font: NSFont.monospacedSystemFont(ofSize: CGFloat(size) * 0.22, weight: .bold),
        .foregroundColor: NSColor(calibratedRed: 0.06, green: 0.18, blue: 0.20, alpha: 1.0),
        .paragraphStyle: paragraph
    ]
    let textRect = NSRect(x: bounds.minX, y: bounds.midY - CGFloat(size) * 0.07, width: bounds.width, height: CGFloat(size) * 0.16)
    codeText.draw(in: textRect, withAttributes: attributes)

    let barWidth = CGFloat(size) * 0.06
    let barHeight = CGFloat(size) * 0.22
    let leftBar = NSBezierPath(roundedRect: NSRect(x: bounds.midX - CGFloat(size) * 0.21, y: bounds.midY - barHeight / 2, width: barWidth, height: barHeight), xRadius: barWidth / 2, yRadius: barWidth / 2)
    NSColor(calibratedRed: 0.10, green: 0.63, blue: 0.58, alpha: 1.0).setFill()
    leftBar.fill()

    return image
}

func writePNG(image: NSImage, to url: URL) throws {
    guard let tiff = image.tiffRepresentation,
          let rep = NSBitmapImageRep(data: tiff),
          let png = rep.representation(using: .png, properties: [:]) else {
        throw NSError(domain: "LocalCodexIcon", code: 1, userInfo: [NSLocalizedDescriptionKey: "Could not encode PNG"])
    }
    try png.write(to: url)
}

let outputDir = URL(fileURLWithPath: CommandLine.arguments.dropFirst().first ?? FileManager.default.currentDirectoryPath, isDirectory: true)
let sizes: [IconSpec] = [
    .init(size: 16, suffix: "icon_16x16"),
    .init(size: 32, suffix: "icon_16x16@2x"),
    .init(size: 32, suffix: "icon_32x32"),
    .init(size: 64, suffix: "icon_32x32@2x"),
    .init(size: 128, suffix: "icon_128x128"),
    .init(size: 256, suffix: "icon_128x128@2x"),
    .init(size: 256, suffix: "icon_256x256"),
    .init(size: 512, suffix: "icon_256x256@2x"),
    .init(size: 512, suffix: "icon_512x512"),
    .init(size: 1024, suffix: "icon_512x512@2x"),
]

try FileManager.default.createDirectory(at: outputDir, withIntermediateDirectories: true)
for spec in sizes {
    let image = renderIcon(size: spec.size)
    try writePNG(image: image, to: outputDir.appendingPathComponent("\(spec.suffix).png"))
}
