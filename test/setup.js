// Mock global gettext function (provided by Django JS catalog)
global.gettext = str => str
global.interpolate = (str, args) => {
    return str.replace(/%s/g, () => args.shift())
}

// The document HTML/EPUB exporters load stylesheets through the global
// `fetch`. Stub it so no network access is attempted during tests.
global.fetch = () =>
    Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve(""),
        json: () => Promise.resolve({}),
        blob: () => Promise.resolve(new Blob([]))
    })
