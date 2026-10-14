// swift-tools-version: 6.0
import PackageDescription

let generatedCodeSettings: [SwiftSetting] = [.unsafeFlags(["-suppress-warnings"])]

let package = Package(
    name: "EffectDrive",
    platforms: [.macOS("14.4")],
    products: [
        .executable(name: "EffectDrive", targets: ["EffectDrive"]),
    ],
    dependencies: [
        .package(url: "https://github.com/apple/swift-openapi-runtime", from: "1.8.0"),
        .package(url: "https://github.com/apple/swift-openapi-urlsession", from: "1.1.0"),
        .package(url: "https://github.com/apple/swift-http-types", from: "1.3.0"),
    ],
    targets: [
        .target(
            name: "DriveAPI",
            dependencies: [.product(name: "OpenAPIRuntime", package: "swift-openapi-runtime")],
            swiftSettings: generatedCodeSettings
        ),
        .target(
            name: "SyncAPI",
            dependencies: [.product(name: "OpenAPIRuntime", package: "swift-openapi-runtime")],
            swiftSettings: generatedCodeSettings
        ),
        .target(
            name: "AuthAPI",
            dependencies: [.product(name: "OpenAPIRuntime", package: "swift-openapi-runtime")],
            swiftSettings: generatedCodeSettings
        ),
        .executableTarget(
            name: "EffectDrive",
            dependencies: [
                "DriveAPI",
                "SyncAPI",
                "AuthAPI",
                .product(name: "OpenAPIRuntime", package: "swift-openapi-runtime"),
                .product(name: "OpenAPIURLSession", package: "swift-openapi-urlsession"),
                .product(name: "HTTPTypes", package: "swift-http-types"),
            ]
        ),
        .testTarget(
            name: "EffectDriveTests",
            dependencies: [
                "EffectDrive",
                "DriveAPI",
                "SyncAPI",
                "AuthAPI",
                .product(name: "OpenAPIRuntime", package: "swift-openapi-runtime"),
                .product(name: "HTTPTypes", package: "swift-http-types"),
            ]
        ),
    ]
)
