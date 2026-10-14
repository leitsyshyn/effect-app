import PDFKit
import SwiftUI

struct PreviewPane: View {
    let model: DriveViewModel
    let download: (DriveItem) -> Void
    let open: (DriveItem) -> Void

    var body: some View {
        if let item = model.preview.item {
            VStack(spacing: 0) {
                HStack(spacing: 6) {
                    ItemIcon(item)
                    Text(item.name).fontWeight(.medium).lineLimit(1).truncationMode(.middle).help(item.name)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, Layout.inset)
                .frame(height: Layout.barHeight)
                Divider()
                contents
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(.background)
                Divider()
                details(item)
                Divider()
                footer(item)
            }
        } else {
            ContentUnavailableView(
                model.selection.count > 1 ? "\(model.selection.count) items selected" : "No selection",
                systemImage: "doc.text.magnifyingglass",
                description: Text("Select a file to preview it.")
            )
        }
    }

    @ViewBuilder
    private var contents: some View {
        switch model.preview {
        case .none:
            EmptyView()
        case .loading:
            ProgressView()
        case .text(_, let text):
            ScrollView {
                Text(text.isEmpty ? "Empty file" : text)
                    .font(.system(.callout, design: .monospaced))
                    .foregroundStyle(text.isEmpty ? .secondary : .primary)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(Layout.inset)
            }
        case .image(_, let image):
            Image(nsImage: image)
                .resizable()
                .aspectRatio(contentMode: .fit)
                .padding(Layout.inset)
        case .pdf(_, let document):
            PDFDocumentView(document: document)
        case .metadata(let item, let note):
            placeholder(item.isFolder ? "Folder" : note ?? "No preview", systemImage: item.systemImage)
        case .failed(_, let message):
            placeholder(message, systemImage: "exclamationmark.triangle")
        }
    }

    private func placeholder(_ text: String, systemImage: String) -> some View {
        VStack(spacing: Layout.spacing) {
            Image(systemName: systemImage).font(.largeTitle)
            Text(text)
        }
        .foregroundStyle(.secondary)
        .multilineTextAlignment(.center)
        .padding(Layout.inset)
    }

    private func details(_ item: DriveItem) -> some View {
        let location = (["My Drive"] + model.path.map(\.name)).joined(separator: " › ")
        return Grid(alignment: .leading, horizontalSpacing: Layout.inset, verticalSpacing: 4) {
            row("Location", model.folderName, help: location)
            if item.isFolder {
                row("Type", "Folder")
            } else {
                row("Type", item.fileType.isEmpty ? "No extension" : ".\(item.fileType)")
                row("Format", item.contentType ?? "Unknown")
                row("Size", Formatting.detailedSize(item.size))
            }
            row("Uploaded at", Formatting.timestamp(item.createdAt), help: Formatting.fullTimestamp(item.createdAt))
            row("Uploaded by", item.createdBy)
            row("Last edited at", Formatting.timestamp(item.updatedAt), help: Formatting.fullTimestamp(item.updatedAt))
            row("Last edited by", item.updatedBy)
            row("Version", "\(item.revision)")
        }
        .font(.callout)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(Layout.inset)
    }

    private func row(_ label: String, _ value: String, help: String? = nil) -> some View {
        GridRow {
            Text(label).foregroundStyle(.secondary)
            Text(value)
                .lineLimit(1)
                .truncationMode(.middle)
                .textSelection(.enabled)
                .help(help ?? value)
        }
    }

    private func footer(_ item: DriveItem) -> some View {
        let files = model.previewFiles
        let index = files.firstIndex(of: item)
        return HStack(spacing: Layout.spacing) {
            if let index, files.count > 1 {
                Button { model.stepPreview(-1) } label: { Image(systemName: "chevron.left") }
                    .disabled(model.previewNeighbour(-1) == nil)
                    .help("Previous file (←)")
                Text("\(index + 1) of \(files.count)")
                    .monospacedDigit()
                    .foregroundStyle(.secondary)
                    .frame(minWidth: 56)
                Button { model.stepPreview(1) } label: { Image(systemName: "chevron.right") }
                    .disabled(model.previewNeighbour(1) == nil)
                    .help("Next file (→)")
            }
            Spacer()
            if item.isFolder {
                Button("Open") { open(item) }
            } else {
                Button { download(item) } label: { Label("Download…", systemImage: "square.and.arrow.down") }
            }
        }
        .buttonStyle(.bordered)
        .controlSize(.small)
        .font(.callout)
        .padding(.horizontal, Layout.inset)
        .frame(height: Layout.barHeight)
    }
}

extension FilePreview {
    var item: DriveItem? {
        switch self {
        case .none: nil
        case .loading(let item), .text(let item, _), .image(let item, _), .pdf(let item, _),
             .metadata(let item, _), .failed(let item, _): item
        }
    }
}

private struct PDFDocumentView: NSViewRepresentable {
    let document: PDFDocument

    func makeNSView(context: Context) -> PDFView {
        let view = PDFView()
        view.autoScales = true
        view.displayMode = .singlePageContinuous
        view.backgroundColor = .textBackgroundColor
        return view
    }

    func updateNSView(_ view: PDFView, context: Context) {
        if view.document !== document { view.document = document }
    }
}
