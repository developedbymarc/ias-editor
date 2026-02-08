// ansi-to-html-simple.js
const htmlEscape = (s) =>
  s.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );

// map SGR codes to CSS colors
const CSS_COLORS = {
  30: "black",
  31: "red",
  32: "green",
  33: "yellow",
  34: "blue",
  35: "magenta",
  36: "cyan",
  37: "white",
  90: "#808080",
  91: "#ff5555",
  92: "#55ff55",
  93: "#ffff55",
  94: "#5555ff",
  95: "#ff55ff",
  96: "#55ffff",
  97: "#ffffff",
};

function sgrToStyle(sgrList, cur) {
  // cur: {color, background, bold, underline, inverse}
  for (const code of sgrList) {
    if (code === 0) {
      cur.color = null;
      cur.background = null;
      cur.bold = false;
      cur.underline = false;
      cur.inverse = false;
      continue;
    }
    if (code === 1) {
      cur.bold = true;
      continue;
    }
    if (code === 4) {
      cur.underline = true;
      continue;
    }
    if (code === 7) {
      cur.inverse = true;
      continue;
    }
    if (code === 21 || code === 22) {
      cur.bold = false;
      continue;
    }
    if (code === 24) {
      cur.underline = false;
      continue;
    }
    if ((code >= 30 && code <= 37) || (code >= 90 && code <= 97)) {
      cur.color = CSS_COLORS[code];
      continue;
    }
    if ((code >= 40 && code <= 47) || (code >= 100 && code <= 107)) {
      // background codes: map to foreground equivalents by subtracting 10 or 60 for bright
      const fg = code >= 100 ? code - 60 : code - 10;
      cur.background = CSS_COLORS[fg] || null;
      continue;
    }
    // ignore extended colors (38/48) here for simplicity
  }
  return cur;
}

function styleToSpanOpen(cur) {
  const styles = [];
  if (cur.inverse) {
    // swap colors
    if (cur.color) styles.push(`background:${cur.color}`);
    if (cur.background) styles.push(`color:${cur.background}`);
  } else {
    if (cur.color) styles.push(`color:${cur.color}`);
    if (cur.background) styles.push(`background:${cur.background}`);
  }
  if (cur.bold) styles.push("font-weight:700");
  if (cur.underline) styles.push("text-decoration:underline");
  return styles.length ? `<span style="${styles.join(";")}">` : "";
}

function convertAnsiToHtml(input) {
  // handle CR (\r) by replacing last line when \r not followed by \n
  // We'll process stream-wise: keep an array of lines; \r will replace current line content.
  const ESC = "\x1b";
  let out = "";
  let i = 0;
  let cur = {
    color: null,
    background: null,
    bold: false,
    underline: false,
    inverse: false,
  };
  let openSpan = "";

  while (i < input.length) {
    const ch = input[i];

    if (ch === ESC && input[i + 1] === "[") {
      // parse CSI ... m
      let j = i + 2;
      let params = "";
      while (j < input.length && input[j] !== "m") {
        params += input[j++];
      }
      if (input[j] !== "m") {
        // malformed, print literally
        out += htmlEscape(ch);
        i++;
        continue;
      }
      const nums = params.length
        ? params.split(";").map((s) => parseInt(s || "0", 10))
        : [0];
      // close previous span if style changes
      if (openSpan) {
        out += "</span>";
        openSpan = "";
      }
      cur = sgrToStyle(nums, cur);
      const spanOpen = styleToSpanOpen(cur);
      if (spanOpen) {
        out += spanOpen;
        openSpan = spanOpen;
      }
      i = j + 1;
      continue;
    }

    if (ch === "\r") {
      // carriage return: move cursor to line start -> we simulate by removing text since last newline
      // find last newline in out
      const lastNewline = out.lastIndexOf("\n");
      if (lastNewline === -1) out = "";
      else out = out.slice(0, lastNewline + 1);
      i++;
      continue;
    }

    if (ch === "\n") {
      out += "\n";
      i++;
      continue;
    }

    // normal char
    // append escaped char
    out += htmlEscape(ch);
    i++;
  }

  if (openSpan) out += "</span>";
  // convert newlines to <br> and wrap in <pre> to preserve spacing
  const html = `<pre style="white-space:pre-wrap; margin:0">${out.replace(/\n/g, "<br>")}</pre>`;
  return html;
}

module.exports = { convertAnsiToHtml };
