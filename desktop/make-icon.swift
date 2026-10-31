import AppKit

guard CommandLine.arguments.count == 3,
      let image = NSImage(contentsOfFile:CommandLine.arguments[1]) else {
    fatalError("Usage: make-icon.swift source.svg output.iconset")
}
let directory = URL(fileURLWithPath:CommandLine.arguments[2],isDirectory:true)
try FileManager.default.createDirectory(at:directory,withIntermediateDirectories:true)
for size in [16, 32, 128, 256, 512] {
    for scale in [1, 2] {
        let pixels = size * scale
        guard let bitmap = NSBitmapImageRep(bitmapDataPlanes:nil,pixelsWide:pixels,pixelsHigh:pixels,bitsPerSample:8,samplesPerPixel:4,hasAlpha:true,isPlanar:false,colorSpaceName:.deviceRGB,bytesPerRow:0,bitsPerPixel:0),
              let context = NSGraphicsContext(bitmapImageRep:bitmap) else { fatalError("Cannot create icon bitmap") }
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = context
        context.imageInterpolation = .high
        image.draw(in:NSRect(x:0,y:0,width:pixels,height:pixels),from:.zero,operation:.copy,fraction:1)
        NSGraphicsContext.restoreGraphicsState()
        guard let data = bitmap.representation(using:.png,properties:[:]) else { fatalError("Cannot encode icon PNG") }
        let suffix = scale == 2 ? "@2x" : ""
        try data.write(to:directory.appendingPathComponent("icon_\(size)x\(size)\(suffix).png"))
    }
}
