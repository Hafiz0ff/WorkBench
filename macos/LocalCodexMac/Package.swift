// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "LocalCodexMac",
    defaultLocalization: "ru",
    platforms: [
        .macOS(.v15)
    ],
    products: [
        .executable(name: "LocalCodexMac", targets: ["LocalCodexMac"]),
    ],
    targets: [
        .executableTarget(
            name: "LocalCodexMac",
            path: "Sources/LocalCodexMac",
            resources: [
                .process("Resources")
            ]
        ),
        .testTarget(
            name: "LocalCodexMacTests",
            dependencies: ["LocalCodexMac"],
            path: "Tests/LocalCodexMacTests"
        ),
    ]
)
