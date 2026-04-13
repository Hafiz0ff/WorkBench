import Foundation
import XCTest
@testable import LocalCodexMac

@MainActor
final class EngineBridgeTests: XCTestCase {
    func testResolveNodeExecutablePrefersExplicitEnvironmentOverride() throws {
        let tempRoot = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        let explicitNode = tempRoot.appendingPathComponent("node")
        try FileManager.default.createDirectory(at: tempRoot, withIntermediateDirectories: true)
        FileManager.default.createFile(atPath: explicitNode.path, contents: Data(), attributes: nil)
        try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: explicitNode.path)

        let resolved = EngineBridge.resolveNodeExecutable(
            fileManager: .default,
            homeDirectory: tempRoot,
            environment: ["LOCALCODEX_NODE_BINARY": explicitNode.path]
        )

        XCTAssertEqual(resolved?.path, explicitNode.path)
    }

    func testResolveNodeExecutableFindsNodeInNvmHome() throws {
        let homeRoot = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        let node = homeRoot
            .appendingPathComponent(".nvm", isDirectory: true)
            .appendingPathComponent("versions", isDirectory: true)
            .appendingPathComponent("node", isDirectory: true)
            .appendingPathComponent("v24.14.0", isDirectory: true)
            .appendingPathComponent("bin", isDirectory: true)
            .appendingPathComponent("node")

        try FileManager.default.createDirectory(at: node.deletingLastPathComponent(), withIntermediateDirectories: true)
        FileManager.default.createFile(atPath: node.path, contents: Data(), attributes: nil)
        try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: node.path)

        let resolved = EngineBridge.resolveNodeExecutable(
            fileManager: .default,
            homeDirectory: homeRoot,
            environment: [:]
        )

        XCTAssertEqual(resolved?.standardizedFileURL.path, node.standardizedFileURL.path)
    }
}
