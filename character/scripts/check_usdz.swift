// Load a USDZ with SceneKit (what the Apple TV app uses) and report what it sees.
//   swift scripts/check_usdz.swift file.usdz [snapshot.png] [second time in s, default 1.25] [camera: stand | floor]
import Foundation
import SceneKit
import AppKit

let args = CommandLine.arguments
guard args.count > 1 else { print("usage: check_usdz.swift file.usdz [snapshot.png]"); exit(2) }
let url = URL(fileURLWithPath: args[1])
let scene: SCNScene
do { scene = try SCNScene(url: url, options: [.checkConsistency: true]) } catch { print("LOAD FAILED: \(error)"); exit(1) }

var nodes = 0, geoms = 0, skinners = 0, bones = 0, tris = 0, anims = 0
var animInfo: [String] = []
var mats = Set<String>()
scene.rootNode.enumerateHierarchy { n, _ in
    nodes += 1
    if let g = n.geometry {
        geoms += 1
        for e in g.elements where e.primitiveType == .triangles { tris += e.primitiveCount }
        for m in g.materials { mats.insert("\(m.name ?? "?"): diffuse=\(m.diffuse.contents != nil) normal=\(m.normal.contents != nil) roughness=\(m.roughness.contents != nil)") }
    }
    if let s = n.skinner { skinners += 1; bones = max(bones, s.bones.count) }
    for k in n.animationKeys {
        anims += 1
        if let p = n.animationPlayer(forKey: k) {
            animInfo.append("\(n.name ?? "?")/\(k): \(String(format: "%.2f", p.animation.duration)) s, repeat \(p.animation.repeatCount)")
        }
    }
}
let (mn, mx) = scene.rootNode.boundingBox
print("nodes \(nodes) | geometries \(geoms) | triangles \(tris) | skinners \(skinners) | bones in skinner \(bones) | animations \(anims)")
for a in animInfo.prefix(6) { print("  animation", a) }
for m in mats.sorted() { print("  material", m) }
print(String(format: "bounds min (%.3f, %.3f, %.3f) max (%.3f, %.3f, %.3f)", mn.x, mn.y, mn.z, mx.x, mx.y, mx.z))

if args.count > 2 {
    // offscreen render at two times of the animation, side by side: proves the skeleton moves the mesh
    let r = SCNRenderer(device: nil, options: nil)
    r.scene = scene
    r.autoenablesDefaultLighting = true
    let cam = SCNNode(); cam.camera = SCNCamera(); cam.camera!.fieldOfView = 30
    if args.count > 4 && args[4] == "floor" { cam.position = SCNVector3(2.6, 1.7, 2.8); cam.look(at: SCNVector3(0, 0.1, 0)) }
    else { cam.position = SCNVector3(1.6, 1.25, 4.4); cam.look(at: SCNVector3(0, 0.95, 0)) }
    let t2 = args.count > 3 ? (Double(args[3]) ?? 1.25) : 1.25
    scene.rootNode.addChildNode(cam); r.pointOfView = cam
    scene.background.contents = NSColor(calibratedRed: 0.1, green: 0.12, blue: 0.19, alpha: 1)
    let size = CGSize(width: 700, height: 900)
    let a = r.snapshot(atTime: 0.0, with: size, antialiasingMode: .multisampling4X)
    let b = r.snapshot(atTime: t2, with: size, antialiasingMode: .multisampling4X)
    let out = NSImage(size: NSSize(width: size.width * 2, height: size.height))
    out.lockFocus(); a.draw(in: NSRect(x: 0, y: 0, width: size.width, height: size.height)); b.draw(in: NSRect(x: size.width, y: 0, width: size.width, height: size.height)); out.unlockFocus()
    if let t = out.tiffRepresentation, let rep = NSBitmapImageRep(data: t), let png = rep.representation(using: .png, properties: [:]) {
        try? png.write(to: URL(fileURLWithPath: args[2])); print("snapshot", args[2])
    }
}
