/**
 * LaTeX to Typst math conversion.
 *
 * Fidus Writer stores equations as LaTeX source; Typst has its own math
 * syntax. The two overlap enough that most equations need only a few
 * well-known commands rewritten. The conversion is deliberately
 * best-effort: every LaTeX command that has a direct Typst equivalent is
 * translated, structures like `\\frac`/`\\sqrt` are rebuilt, and anything
 * unrecognized is kept as an identifier (the backslash is dropped) so that
 * the output always compiles.
 * @module
 */

/** Spacing commands and their Typst math names. */
const SPACING: Record<string, string> = {
    ",": "thin",
    ";": "thick",
    ":": "med",
    " ": "space",
    quad: "quad",
    qquad: "quad quad"
}

/** LaTeX commands whose single-character argument should vanish. */
const DROPPED_COMMANDS = new Set([
    "left",
    "right",
    "big",
    "Big",
    "bigg",
    "Bigg",
    "bigl",
    "bigr",
    "Bigl",
    "Bigr",
    "displaystyle",
    "limits"
])

/** Commands translated to plain Typst identifiers (compile-checked). */
const SYMBOLS: Record<string, string> = {
    // Big operators
    int: "integral",
    iint: "integral.double",
    iiint: "integral.triple",
    oint: "integral.cont",
    oiint: "∯",
    oiiint: "∰",
    sum: "sum",
    prod: "product",
    coprod: "product.co",
    bigcup: "union.big",
    bigcap: "inter.big",
    bigvee: "or.big",
    bigwedge: "and.big",
    lim: "lim",
    liminf: "lim inf",
    limsup: "lim sup",
    // Functions
    log: "log",
    ln: "ln",
    lg: "lg",
    sin: "sin",
    cos: "cos",
    tan: "tan",
    cot: "cot",
    sec: "sec",
    csc: "csc",
    arcsin: "arcsin",
    arccos: "arccos",
    arctan: "arctan",
    sinh: "sinh",
    cosh: "cosh",
    tanh: "tanh",
    exp: "exp",
    min: "min",
    max: "max",
    sup: "sup",
    inf: "inf",
    det: "det",
    dim: "dim",
    ker: "ker",
    deg: "deg",
    gcd: "gcd",
    arg: "arg",
    // Greek (lower)
    alpha: "alpha",
    beta: "beta",
    gamma: "gamma",
    delta: "delta",
    epsilon: "epsilon",
    varepsilon: "epsilon.alt",
    zeta: "zeta",
    eta: "eta",
    theta: "theta",
    vartheta: "theta.alt",
    iota: "iota",
    kappa: "kappa",
    lambda: "lambda",
    mu: "mu",
    nu: "nu",
    xi: "xi",
    pi: "pi",
    varpi: "pi.alt",
    rho: "rho",
    varrho: "rho.alt",
    sigma: "sigma",
    varsigma: "sigma.alt",
    tau: "tau",
    upsilon: "upsilon",
    phi: "phi",
    varphi: "phi.alt",
    chi: "chi",
    psi: "psi",
    omega: "omega",
    // Greek (upper)
    Alpha: "Alpha",
    Beta: "Beta",
    Gamma: "Gamma",
    Delta: "Delta",
    Epsilon: "Epsilon",
    Zeta: "Zeta",
    Eta: "Eta",
    Theta: "Theta",
    Iota: "Iota",
    Kappa: "Kappa",
    Lambda: "Lambda",
    Mu: "Mu",
    Nu: "Nu",
    Xi: "Xi",
    Omicron: "Omicron",
    Pi: "Pi",
    Sigma: "Sigma",
    Tau: "Tau",
    Upsilon: "Upsilon",
    Phi: "Phi",
    Chi: "Chi",
    Psi: "Psi",
    Omega: "Omega",
    // Relations
    leq: "lt.eq",
    le: "lt.eq",
    geq: "gt.eq",
    ge: "gt.eq",
    neq: "eq.not",
    ne: "eq.not",
    equiv: "equiv",
    approx: "approx",
    propto: "prop",
    prec: "prec",
    succ: "succ",
    preceq: "prec.eq",
    succeq: "succ.eq",
    ll: "lt.double",
    gg: "gt.double",
    llless: "lt.double",
    lll: "lt.double",
    ggg: "gt.double",
    sim: "tilde.op",
    simeq: "tilde.eq",
    cong: "tilde.eq",
    asymp: "tilde.op",
    doteq: "approx",
    // Binary operators
    times: "times",
    div: "div",
    cdot: "dot.op",
    ast: "ast",
    star: "star",
    circ: "compose",
    bullet: "bullet",
    oplus: "plus.o",
    ominus: "minus.o",
    otimes: "times.o",
    oslash: "div.o",
    odot: "dot.o",
    wedge: "and",
    vee: "or",
    cap: "inter",
    cup: "union",
    setminus: "without",
    smallsetminus: "without",
    wreath: "≀",
    // Arrows
    to: "arrow",
    gets: "arrow.l",
    rightarrow: "arrow",
    leftarrow: "arrow.l",
    leftrightarrow: "arrow.l.r",
    Rightarrow: "arrow.double",
    Leftarrow: "arrow.l.double",
    Leftrightarrow: "arrow.l.r.double",
    mapsto: "arrow.r.bar",
    longmapsto: "arrow.r.bar",
    hookrightarrow: "arrow.r.hook",
    rightleftharpoons: "harpoons.rtlb",
    uparrow: "arrow.t",
    downarrow: "arrow.b",
    updownarrow: "arrow.t.b",
    Uparrow: "arrow.t.double",
    Downarrow: "arrow.b.double",
    nearrow: "arrow.tr",
    searrow: "arrow.br",
    swarrow: "arrow.bl",
    nwarrow: "arrow.tl",
    // Misc symbols
    infty: "infinity",
    partial: "partial",
    nabla: "nabla",
    emptyset: "emptyset",
    varnothing: "nothing",
    in: "in",
    notin: "in.not",
    ni: "in.rev",
    subset: "subset",
    supset: "supset",
    subseteq: "subset.eq",
    supseteq: "supset.eq",
    nsubseteq: "subset.eq.not",
    nsupseteq: "supset.eq.not",
    forall: "forall",
    exists: "exists",
    nexists: "exists.not",
    neg: "not",
    lnot: "not",
    land: "and",
    lor: "or",
    top: "top",
    bot: "bot",
    vdash: "tack",
    models: "models",
    lceil: "ceil.l",
    rceil: "ceil.r",
    lfloor: "floor.l",
    rfloor: "floor.r",
    langle: "chevron.l",
    rangle: "chevron.r",
    lbrace: "\\{",
    rbrace: "\\}",
    lvert: "bar.v",
    rvert: "bar.v",
    lVert: "bar.v.double",
    rVert: "bar.v.double",
    vert: "bar.v",
    Vert: "bar.v.double",
    angle: "angle",
    measuredangle: "angle.arc",
    therefore: "therefore",
    because: "because",
    aleph: "aleph",
    hbar: "planck",
    ell: "ell",
    Re: "Re",
    Im: "Im",
    wp: "℘",
    primes: "prime",
    prime: "prime",
    nablaup: "nabla",
    checkmark: "checkmark",
    dagger: "dagger",
    ddagger: "dagger.double",
    ldots: "dots",
    dots: "dots",
    cdots: "dots.c",
    vdots: "dots.v",
    ddots: "dots.down",
    dotsc: "dots.c",
    dotso: "dots",
    flat: "flat",
    natural: "natural",
    sharp: "sharp",
    succsim: "succ.approx",
    gtrsim: "gt.tilde",
    lesssim: "lt.tilde",
    gtrless: "gt.lt",
    lessgtr: "lt.gt"
}

/** Accent commands mapping to Typst accent functions. */
const ACCENTS: Record<string, string> = {
    hat: "hat",
    widehat: "hat",
    bar: "bar",
    overline: "overline",
    underline: "underline",
    tilde: "tilde",
    widetilde: "tilde",
    vec: "arrow",
    dot: "dot",
    ddot: "dot.double"
}

/** Find the brace-delimited group directly after `from`, return [inner, end]. */
function readGroup(source: string, from: number): [string, number] | null {
    let index = from
    while (index < source.length && /\s/.test(source[index])) {
        index++
    }
    if (source[index] !== "{") {
        return null
    }
    let depth = 0
    for (let pos = index; pos < source.length; pos++) {
        if (source[pos] === "{") {
            depth++
        } else if (source[pos] === "}") {
            depth--
            if (depth === 0) {
                return [source.slice(index + 1, pos), pos + 1]
            }
        }
    }
    return null
}

/**
 * Typst math treats a run of letters as one identifier (and errors out if
 * that identifier does not exist); LaTeX renders each letter as its own
 * variable. Split letter runs so the LaTeX meaning survives.
 */
function splitLetters(segment: string): string {
    return segment.replace(/[A-Za-z]{2,}/g, run =>
        run.split("").join(" ")
    )
}

/**
 * Convert a LaTeX math string to Typst math (the content that goes between
 * `$ … $`).
 */
export function latexToTypstMath(latex: string): string {
    let result = ""
    let index = 0
    while (index < latex.length) {
        const char = latex[index]
        if (char !== "\\") {
            // Copy literal characters, splitting multi-letter runs.
            let end = index
            while (end < latex.length && latex[end] !== "\\") {
                end++
            }
            result += splitLetters(latex.slice(index, end))
            index = end
            continue
        }
        const match = /^\\([A-Za-z]+|.)/.exec(latex.slice(index))
        if (!match) {
            index++
            continue
        }
        const command = match[1]
        const after = index + match[0].length

        if (command === "frac" || command === "dfrac" || command === "tfrac") {
            const numerator = readGroup(latex, after)
            if (numerator) {
                const denominator = readGroup(latex, numerator[1])
                if (denominator) {
                    result += `(${latexToTypstMath(numerator[0])})/(${latexToTypstMath(denominator[0])})`
                    index = denominator[1]
                    continue
                }
            }
            result += "/"
            index = after
            continue
        }
        if (command === "sqrt") {
            // Optional root index: \sqrt[n]{x}
            let root: [string, number] | null = null
            if (latex[after] === "[") {
                const close = latex.indexOf("]", after)
                if (close !== -1) {
                    root = [latex.slice(after + 1, close), close + 1]
                }
            }
            const radicand = readGroup(latex, root ? root[1] : after)
            if (radicand) {
                if (root) {
                    result += `root(${latexToTypstMath(root[0])}, ${latexToTypstMath(radicand[0])})`
                } else {
                    result += `sqrt(${latexToTypstMath(radicand[0])})`
                }
                index = radicand[1]
                continue
            }
            result += "sqrt"
            index = after
            continue
        }
        if (
            command === "text" ||
            command === "mathrm" ||
            command === "mathbf" ||
            command === "mathit" ||
            command === "mathsf" ||
            command === "mathtt" ||
            command === "operatorname"
        ) {
            const group = readGroup(latex, after)
            if (group) {
                result += `"${group[0].replace(/"/g, '\\"')}"`
                index = group[1]
                continue
            }
            result += "upright"
            index = after
            continue
        }
        if (command in ACCENTS) {
            const group = readGroup(latex, after)
            if (group) {
                result += `${ACCENTS[command]}(${latexToTypstMath(group[0])})`
                index = group[1]
                continue
            }
        }
        if (command in SPACING) {
            result += ` ${SPACING[command]} `
            index = after
            continue
        }
        if (command === "!") {
            // Negative thin space: no equivalent needed.
            index = after
            continue
        }
        if (DROPPED_COMMANDS.has(command) || command === ".") {
            index = after
            continue
        }
        if (command in SYMBOLS) {
            result += SYMBOLS[command]
            index = after
            continue
        }
        // Unknown command: drop the backslash and split into single letters
        // so the output stays compilable; each letter becomes its own
        // identifier, matching the LaTeX rendering closely enough.
        result += splitLetters(command)
        index = after
    }
    return result
}
