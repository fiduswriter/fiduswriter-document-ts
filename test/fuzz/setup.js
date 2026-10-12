// happy-dom globals for the fuzz harnesses. Must be imported before any
// module that touches window/document at load time; the harnesses import
// the dist code dynamically after this setup.
import {Window} from "happy-dom"

const window = new Window({url: "http://localhost"})

globalThis.window = window
globalThis.document = window.document
globalThis.DOMParser = window.DOMParser
globalThis.XMLSerializer = window.XMLSerializer
globalThis.Blob = window.Blob
globalThis.File = window.File
globalThis.FileReader = window.FileReader
globalThis.gettext = str => str
globalThis.interpolate = (str, args) =>
    str.replace(/%s/g, () => String(args?.shift() ?? ""))
globalThis.staticUrl = path => path
// The native importer reads window.Blob.
global.window = globalThis.window
