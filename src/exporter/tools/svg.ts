import {convertDataURIToBlob} from "fwtoolkit"

interface Svg2pngResult {
    blob: Blob
    width: number
    height: number
}

function pngDimensions(buffer: Uint8Array): {width: number; height: number} {
    // PNG IHDR width/height are big-endian uint32 at offsets 16 and 20.
    const view = new DataView(buffer.buffer, buffer.byteOffset)
    return {width: view.getUint32(16), height: view.getUint32(20)}
}

/**
 * Rasterize an SVG blob to PNG. Uses the DOM canvas in browsers and
 * resvg (Rust/WASM via @resvg/resvg-js, an optional dependency) in
 * DOM-less environments such as Node.js — never a server-side service.
 */
export async function svg2png(blob: Blob): Promise<Svg2pngResult> {
    if (typeof document === "undefined") {
        let Resvg: (typeof import("@resvg/resvg-js"))["Resvg"]
        try {
            ;({Resvg} = await import("@resvg/resvg-js"))
        } catch {
            throw new Error(
                "SVG rasterization in a DOM-less environment requires " +
                    "the optional dependency @resvg/resvg-js to be installed."
            )
        }
        const svg = await blob.text()
        const resvg = new Resvg(svg, {
            fitTo: {mode: "original"}
        })
        const pngBuffer = resvg.render().asPng()
        const {width, height} = pngDimensions(pngBuffer)
        return {
            blob: new Blob([pngBuffer.buffer as ArrayBuffer], {
                type: "image/png"
            }),
            width,
            height
        }
    }
    const img = document.createElement("img")
    const src = URL.createObjectURL(blob)
    img.src = src
    img.setAttribute("style", "position:fixed;left:-200vw;")
    return new Promise(resolve => {
        img.onload = function onload() {
            const canvas = document.createElement("canvas")
            const ctx = canvas.getContext("2d")!
            const ratio = Math.min(
                Math.min(img.width, img.height) / img.width,
                Math.min(img.width, img.height) / img.height
            )
            const width = img.width * ratio
            const height = img.height * ratio
            canvas.width = width
            canvas.height = height
            ctx.drawImage(img, 0, 0, width, height)
            const src = canvas.toDataURL("image/png")
            img.parentElement!.removeChild(img)
            URL.revokeObjectURL(src)
            const pngBlob = convertDataURIToBlob(src)
            resolve({blob: pngBlob, width, height})
        }
        document.body.appendChild(img)
    })
}
