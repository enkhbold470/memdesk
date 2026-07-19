// memdesk OCR helper — extracts on-screen text from a screenshot using the
// macOS Vision framework. Prints recognized text (one line per observation) to
// stdout. Compiled on demand by src/ocr.ts via: swiftc -O ocr.swift -o memdesk-ocr
import CoreGraphics
import Foundation
import ImageIO
import Vision

func fail(_ msg: String, _ code: Int32) -> Never {
    FileHandle.standardError.write((msg + "\n").data(using: .utf8)!)
    exit(code)
}

guard CommandLine.arguments.count > 1 else { fail("usage: memdesk-ocr <image>", 2) }
let path = CommandLine.arguments[1]
let url = URL(fileURLWithPath: path)

guard let src = CGImageSourceCreateWithURL(url as CFURL, nil),
      let cgImage = CGImageSourceCreateImageAtIndex(src, 0, nil)
else {
    fail("could not load image: \(path)", 1)
}

let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = false

let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
do {
    try handler.perform([request])
    let observations = request.results ?? []
    let lines = observations.compactMap { $0.topCandidates(1).first?.string }
    print(lines.joined(separator: "\n"))
} catch {
    fail("ocr failed: \(error)", 1)
}
