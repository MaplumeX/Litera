import type { Element as XmlElement, Node as XmlNode } from "@xmldom/xmldom";

/** Local element name, lowercased and without a namespace prefix (`m:mi` → `mi`). */
export function mathTag(node: XmlNode): string {
  return ((node as XmlElement).tagName ?? "").toLowerCase().replace(/^.*:/, "");
}

export function isMathElement(node: XmlNode): boolean {
  return node.nodeType === 1 && mathTag(node) === "math";
}

const TEX_ENCODINGS = new Set(["application/x-tex", "text/x-tex", "tex", "latex", "application/x-latex"]);

const SYMBOLS: Record<string, string> = {
  α: "\\alpha", β: "\\beta", γ: "\\gamma", δ: "\\delta", ε: "\\epsilon", ϵ: "\\epsilon", ζ: "\\zeta", η: "\\eta",
  θ: "\\theta", ϑ: "\\vartheta", ι: "\\iota", κ: "\\kappa", λ: "\\lambda", μ: "\\mu", ν: "\\nu", ξ: "\\xi",
  π: "\\pi", ϖ: "\\varpi", ρ: "\\rho", σ: "\\sigma", ς: "\\varsigma", τ: "\\tau", υ: "\\upsilon", φ: "\\phi",
  ϕ: "\\phi", χ: "\\chi", ψ: "\\psi", ω: "\\omega", Γ: "\\Gamma", Δ: "\\Delta", Θ: "\\Theta", Λ: "\\Lambda",
  Ξ: "\\Xi", Π: "\\Pi", Σ: "\\Sigma", Υ: "\\Upsilon", Φ: "\\Phi", Ψ: "\\Psi", Ω: "\\Omega",
  "×": "\\times", "·": "\\cdot", "⋅": "\\cdot", "÷": "\\div", "±": "\\pm", "∓": "\\mp", "−": "-", "∗": "\\ast",
  "≤": "\\le", "≥": "\\ge", "≠": "\\neq", "≈": "\\approx", "≡": "\\equiv", "∼": "\\sim", "≅": "\\cong",
  "∝": "\\propto", "≪": "\\ll", "≫": "\\gg", "→": "\\to", "←": "\\leftarrow", "↔": "\\leftrightarrow",
  "⇒": "\\Rightarrow", "⇐": "\\Leftarrow", "⇔": "\\Leftrightarrow", "↦": "\\mapsto", "∞": "\\infty",
  "∑": "\\sum", "∏": "\\prod", "∫": "\\int", "∬": "\\iint", "∮": "\\oint", "∂": "\\partial", "∇": "\\nabla",
  "∈": "\\in", "∉": "\\notin", "∋": "\\ni", "⊂": "\\subset", "⊃": "\\supset", "⊆": "\\subseteq", "⊇": "\\supseteq",
  "∪": "\\cup", "∩": "\\cap", "∅": "\\emptyset", "∀": "\\forall", "∃": "\\exists", "¬": "\\neg", "∧": "\\wedge",
  "∨": "\\vee", "⊕": "\\oplus", "⊗": "\\otimes", "∘": "\\circ", "°": "^\\circ", "′": "'", "″": "''",
  "…": "\\ldots", "⋯": "\\cdots", "⋮": "\\vdots", "⋱": "\\ddots", "⟨": "\\langle", "⟩": "\\rangle",
  "‖": "\\|", "∠": "\\angle", "⊥": "\\perp", "∥": "\\parallel", "ℏ": "\\hbar", "ℓ": "\\ell", "ℝ": "\\mathbb{R}",
  "ℕ": "\\mathbb{N}", "ℤ": "\\mathbb{Z}", "ℚ": "\\mathbb{Q}", "ℂ": "\\mathbb{C}", "√": "\\surd",
  "{": "\\{", "}": "\\}", "%": "\\%", "#": "\\#", "&": "\\&", _: "\\_", $: "\\$",
  // Invisible operators (function application, times, separator, plus) render as nothing.
  "⁡": "", "⁢": "", "⁣": "", "⁤": "",
};

const FUNCTIONS = new Set([
  "sin", "cos", "tan", "cot", "sec", "csc", "arcsin", "arccos", "arctan", "sinh", "cosh", "tanh",
  "log", "ln", "lg", "exp", "lim", "max", "min", "sup", "inf", "det", "dim", "ker", "deg", "gcd", "arg", "Pr",
]);

const ACCENTS: Record<string, string> = {
  "^": "\\hat", ˆ: "\\hat", "̂": "\\hat", "¯": "\\overline", "‾": "\\overline", "̄": "\\bar", "→": "\\vec",
  "⃗": "\\vec", "~": "\\tilde", "˜": "\\tilde", "̃": "\\tilde", "˙": "\\dot", "̇": "\\dot", "¨": "\\ddot",
  "⏞": "\\overbrace", "︷": "\\overbrace",
};

const UNDER_ACCENTS: Record<string, string> = { "_": "\\underline", "¯": "\\underline", "‾": "\\underline", "⏟": "\\underbrace", "︸": "\\underbrace" };

function elementChildren(element: XmlElement): XmlElement[] {
  return Array.from(element.childNodes).filter((child): child is XmlElement => child.nodeType === 1);
}

function textOf(element: XmlElement): string {
  return (element.textContent ?? "").replace(/\s+/g, " ").trim();
}

function symbols(text: string): string {
  let out = "";
  for (const char of text) out = joinTex(out, SYMBOLS[char] ?? char);
  return out;
}

/** Concatenate TeX, separating a control word from a following letter. */
function joinTex(left: string, right: string): string {
  if (!left || !right) return left + right;
  return /\\[a-zA-Z]+$/.test(left) && /^[a-zA-Z0-9]/.test(right) ? `${left} ${right}` : left + right;
}

/** Brace a script argument or base unless it is a single token. */
function group(tex: string): string {
  return /^(?:[^\\{}\s]|\\[a-zA-Z]+|\\.)$/.test(tex) ? tex : `{${tex}}`;
}

function texAnnotation(math: XmlElement): string | undefined {
  for (const annotation of Array.from(math.getElementsByTagName("*"))) {
    if (mathTag(annotation) !== "annotation") continue;
    const encoding = (annotation.getAttribute("encoding") ?? "").toLowerCase();
    const tex = textOf(annotation);
    if (TEX_ENCODINGS.has(encoding) && tex) return tex;
  }
  return undefined;
}

function row(elements: readonly XmlElement[]): string {
  return elements.reduce((tex, child) => joinTex(tex, convert(child)), "");
}

function convert(element: XmlElement): string {
  const tag = mathTag(element);
  const kids = elementChildren(element);
  const arg = (index: number) => (kids[index] ? convert(kids[index]) : "");
  switch (tag) {
    case "mi": {
      const text = textOf(element);
      if (FUNCTIONS.has(text)) return `\\${text}`;
      if ([...text].length > 1) return `\\mathrm{${text}}`;
      const variant = element.getAttribute("mathvariant");
      const symbol = symbols(text);
      if (variant === "bold") return `\\mathbf{${symbol}}`;
      if (variant === "double-struck") return `\\mathbb{${symbol}}`;
      if (variant === "normal" && /^[a-zA-Z]$/.test(text)) return `\\mathrm{${text}}`;
      return symbol;
    }
    case "mn":
      return textOf(element);
    case "mo": {
      const text = textOf(element);
      return FUNCTIONS.has(text) ? `\\${text}` : symbols(text);
    }
    case "mtext":
    case "ms": {
      const text = textOf(element);
      return text ? `\\text{${text.replace(/[{}\\]/g, "")}}` : "";
    }
    case "mspace":
      return "\\,";
    case "mfrac":
      return element.getAttribute("linethickness") === "0" ? `\\binom{${arg(0)}}{${arg(1)}}` : `\\frac{${arg(0)}}{${arg(1)}}`;
    case "msqrt":
      return `\\sqrt{${row(kids)}}`;
    case "mroot":
      return `\\sqrt[${arg(1)}]{${arg(0)}}`;
    case "msup":
      return `${group(arg(0))}^${group(arg(1))}`;
    case "msub":
      return `${group(arg(0))}_${group(arg(1))}`;
    case "msubsup":
      return `${group(arg(0))}_${group(arg(1))}^${group(arg(2))}`;
    case "mover": {
      const accent = ACCENTS[textOf(kids[1] ?? element)];
      return accent && kids[1] && mathTag(kids[1]) === "mo" ? `${accent}{${arg(0)}}` : `\\overset{${arg(1)}}{${arg(0)}}`;
    }
    case "munder": {
      const accent = UNDER_ACCENTS[textOf(kids[1] ?? element)];
      if (accent && kids[1] && mathTag(kids[1]) === "mo") return `${accent}{${arg(0)}}`;
      return isLargeOperator(kids[0]) ? `${arg(0)}_${group(arg(1))}` : `\\underset{${arg(1)}}{${arg(0)}}`;
    }
    case "munderover":
      return isLargeOperator(kids[0])
        ? `${arg(0)}_${group(arg(1))}^${group(arg(2))}`
        : `\\overset{${arg(2)}}{\\underset{${arg(1)}}{${arg(0)}}}`;
    case "mmultiscripts": {
      let tex = group(arg(0));
      for (let index = 1; index + 1 < kids.length && mathTag(kids[index]) !== "mprescripts"; index += 2) {
        const sub = mathTag(kids[index]) === "none" ? "" : arg(index);
        const sup = mathTag(kids[index + 1]) === "none" ? "" : arg(index + 1);
        if (sub) tex += `_${group(sub)}`;
        if (sup) tex += `^${group(sup)}`;
      }
      return tex;
    }
    case "mfenced": {
      const open = element.getAttribute("open") ?? "(";
      const close = element.getAttribute("close") ?? ")";
      const separator = (element.getAttribute("separators") ?? ",").trim().charAt(0);
      const inner = kids.map(convert).join(separator ? `${symbols(separator)} ` : " ");
      return `\\left${fence(open)}${inner}\\right${fence(close)}`;
    }
    case "mtable": {
      const rows = kids
        .filter((child) => mathTag(child) === "mtr" || mathTag(child) === "mlabeledtr")
        .map((tr) => {
          const cells = elementChildren(tr).filter((cell) => mathTag(cell) === "mtd");
          return (mathTag(tr) === "mlabeledtr" ? cells.slice(1) : cells).map((cell) => row(elementChildren(cell))).join(" & ");
        });
      return `\\begin{matrix}${rows.join(" \\\\ ")}\\end{matrix}`;
    }
    case "semantics":
      return kids[0] ? convert(kids[0]) : "";
    case "annotation":
    case "annotation-xml":
    case "none":
    case "mprescripts":
    case "mphantom":
    case "maligngroup":
    case "malignmark":
      return "";
    default:
      // math, mrow, mstyle, mpadded, menclose, merror, mtd and unknown wrappers.
      return row(kids) || (kids.length ? "" : symbols(textOf(element)));
  }
}

function isLargeOperator(element: XmlElement | undefined): boolean {
  if (!element) return false;
  const text = textOf(element);
  return (mathTag(element) === "mo" && /^[∑∏∫∬∮⋃⋂]$/.test(text)) || FUNCTIONS.has(text);
}

function fence(delimiter: string): string {
  return delimiter ? SYMBOLS[delimiter] ?? delimiter : ".";
}

/** LaTeX source of a `<math>` element: its TeX annotation when present, else converted from MathML. */
export function mathLatex(math: XmlElement): string {
  let tex = texAnnotation(math);
  if (tex === undefined) {
    try {
      tex = convert(math);
    } catch {
      tex = "";
    }
  }
  tex ||= (math.getAttribute("alttext") ?? "").trim();
  return tex.replace(/\s+/g, " ").trim();
}

/** `$…$` (or `$$…$$` for display math) Markdown for a `<math>` element; empty when it has no content. */
export function mathMarkdown(math: XmlElement): string {
  const tex = mathLatex(math);
  if (!tex) return "";
  const display = math.getAttribute("display") === "block" || math.getAttribute("mode") === "display";
  return display ? `$$${tex}$$` : `$${tex}$`;
}

/** Plain text of a `<math>` element for search: rendered text nodes, annotations dropped. */
export function mathText(node: XmlNode): string {
  if (node.nodeType === 3 || node.nodeType === 4) return node.nodeValue ?? "";
  if (node.nodeType !== 1) return "";
  const tag = mathTag(node);
  if (tag === "annotation" || tag === "annotation-xml") return "";
  let out = "";
  const children = node.childNodes;
  for (let index = 0; index < children.length; index += 1) out += mathText(children[index]);
  return out;
}
