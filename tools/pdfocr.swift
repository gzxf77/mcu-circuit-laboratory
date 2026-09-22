// pdfocr — 用 macOS 自带的 PDFKit + Vision 对扫描版教材做本机 OCR。
//
// 为什么用它：`电路 第6版 (邱关源).pdf` 是 545 页纯扫描件（每页只有一张图、没有
// 文字层），pypdf 之类抽不出文本。逐页把图片读进模型上下文非常贵，而本机 OCR 只在
// 磁盘上跑：模型只会读到识别出的**文本**，图片不进上下文。
//
// 构建（一次即可，不需要 Xcode 工程、不需要 Homebrew）：
//   swiftc -O -module-cache-path /tmp/swift-modcache tools/pdfocr.swift -o tools/pdfocr
//
// 用法（页码是 1 起的 PDF 页码；页头写到 stderr，stdout 只有正文，便于 grep/重定向）：
//   tools/pdfocr "电路 第6版 (邱关源).pdf" 17 23        # OCR 第 17–23 页
//   tools/pdfocr "电路 第6版 (邱关源).pdf" 210 | head   # 只看第 210 页
//
// 已知短板：公式、上下标、求和/积分号、相量点会识别错。遇到必须精确的公式时，单独看
// 那一页的图（或请用户截图），不要凭 OCR 文本猜公式。
import Foundation
import PDFKit
import Vision
import AppKit

let args = CommandLine.arguments
guard args.count >= 2 else {
    FileHandle.standardError.write("usage: pdfocr <pdf> [firstPage] [lastPage]  (1-based)\n".data(using: .utf8)!)
    exit(1)
}
let url = URL(fileURLWithPath: args[1])
guard let doc = PDFDocument(url: url) else {
    FileHandle.standardError.write("cannot open \(args[1])\n".data(using: .utf8)!)
    exit(1)
}
let first = args.count > 2 ? (Int(args[2]) ?? 1) : 1
let last = args.count > 3 ? (Int(args[3]) ?? first) : first
// 2 倍渲染在识别质量和耗时之间比较平衡（实测约 0.7 s/页）。
let scale: CGFloat = 2.0

for pageNumber in first...max(first, min(last, doc.pageCount)) {
    guard pageNumber >= 1, pageNumber <= doc.pageCount, let page = doc.page(at: pageNumber - 1) else { continue }
    let bounds = page.bounds(for: .mediaBox)
    let image = page.thumbnail(of: NSSize(width: bounds.width * scale, height: bounds.height * scale), for: .mediaBox)
    guard let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else { continue }
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.recognitionLanguages = ["zh-Hans", "en-US"]
    request.usesLanguageCorrection = true
    try? VNImageRequestHandler(cgImage: cgImage, options: [:]).perform([request])
    FileHandle.standardError.write("=== PDF 页 \(pageNumber) ===\n".data(using: .utf8)!)
    for observation in request.results ?? [] {
        if let candidate = observation.topCandidates(1).first { print(candidate.string) }
    }
}
