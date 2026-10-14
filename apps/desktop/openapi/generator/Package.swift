// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "OpenAPIGeneratorTool",
    platforms: [.macOS(.v14)],
    dependencies: [
        .package(url: "https://github.com/apple/swift-openapi-generator", from: "1.10.0"),
    ]
)
